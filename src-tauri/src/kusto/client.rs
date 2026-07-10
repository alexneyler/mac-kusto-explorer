//! Kusto data-plane client: acquires a token, POSTs KQL to the cluster, and
//! parses the response. The HTTP layer is hidden behind [`HttpTransport`] so the
//! routing/error logic can be unit-tested without a network.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::model::KustoResultSet;
use super::parser;
use super::schema;
use crate::auth::TokenProvider;
use crate::error::{AppError, Result};

/// A raw HTTP response (status code + body text).
#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

/// Abstraction over the HTTP POST used to reach Kusto.
#[async_trait]
pub trait HttpTransport: Send + Sync {
    async fn post_json(
        &self,
        url: &str,
        bearer: &str,
        body: Value,
        headers: &[(String, String)],
    ) -> Result<HttpResponse>;
}

/// Real transport backed by `reqwest`.
pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn post_json(
        &self,
        url: &str,
        bearer: &str,
        body: Value,
        headers: &[(String, String)],
    ) -> Result<HttpResponse> {
        let mut req = self
            .client
            .post(url)
            .bearer_auth(bearer)
            .header("Accept", "application/json")
            .json(&body);
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = req.send().await.map_err(|e| AppError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        let body = resp.text().await.map_err(|e| AppError::Http(e.to_string()))?;
        Ok(HttpResponse { status, body })
    }
}

/// Executes KQL queries and management commands against a Kusto cluster.
pub struct KustoClient {
    transport: Arc<dyn HttpTransport>,
    tokens: Arc<dyn TokenProvider>,
}

impl KustoClient {
    pub fn new(transport: Arc<dyn HttpTransport>, tokens: Arc<dyn TokenProvider>) -> Self {
        Self { transport, tokens }
    }

    /// Execute `query` against `database` on `cluster`. Control commands
    /// (those starting with `.`) are routed to the management endpoint; all
    /// other text is treated as a query.
    pub async fn execute(
        &self,
        cluster: &str,
        database: &str,
        query: &str,
        tenant: Option<&str>,
    ) -> Result<KustoResultSet> {
        let cluster_url = normalize_cluster_url(cluster)?;
        let token = self.tokens.get_token(&cluster_url, tenant).await?;

        let is_mgmt = is_management_command(query);
        let url = if is_mgmt {
            format!("{cluster_url}/v1/rest/mgmt")
        } else {
            format!("{cluster_url}/v2/rest/query")
        };

        let body = json!({ "db": database, "csl": query });
        let resp = self
            .transport
            .post_json(&url, &token.token, body, &default_headers())
            .await?;

        if !(200..300).contains(&resp.status) {
            return Err(AppError::Kusto(describe_http_error(resp.status, &resp.body)));
        }

        if is_mgmt {
            parser::parse_v1_response(&resp.body)
        } else {
            parser::parse_v2_response(&resp.body)
        }
    }

    /// List database names on `cluster` via `.show databases`.
    pub async fn list_databases(
        &self,
        cluster: &str,
        tenant: Option<&str>,
    ) -> Result<Vec<String>> {
        let rs = self
            .execute(cluster, "NetDefaultDB", ".show databases", tenant)
            .await?;
        Ok(schema::database_names(&rs))
    }

    /// Fetch a database's schema, returning both the compact tree structure and
    /// the raw `showSchema.Result` (for monaco-kusto IntelliSense on the frontend).
    pub async fn get_schema(
        &self,
        cluster: &str,
        database: &str,
        tenant: Option<&str>,
    ) -> Result<(schema::DatabaseSchema, Value)> {
        let command = format!(
            ".show database {} schema as json",
            quote_database_name(database)
        );
        let rs = self.execute(cluster, database, &command, tenant).await?;
        let raw = schema::extract_schema_json(&rs)?;
        let structured = schema::parse_show_schema(&raw, database)?;
        Ok((structured, raw))
    }
}

/// Quote a database name for use in a control command. Simple identifiers are
/// left bare; anything else is wrapped in `["..."]` with escaping.
pub fn quote_database_name(name: &str) -> String {
    let is_simple = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        && name.chars().next().map(|c| c.is_ascii_alphabetic() || c == '_').unwrap_or(false);
    if is_simple {
        name.to_string()
    } else {
        let escaped = name.replace('\\', "\\\\").replace('"', "\\\"");
        format!("[\"{escaped}\"]")
    }
}

/// Control commands begin with a leading dot (`.show`, `.create`, ...).
pub fn is_management_command(query: &str) -> bool {
    query.trim_start().starts_with('.')
}

/// Normalize user-entered cluster text into a canonical `https://host` URL:
///  - `help`                              -> `https://help.kusto.windows.net`
///  - `help.kusto.windows.net`            -> `https://help.kusto.windows.net`
///  - `https://help.kusto.windows.net/`   -> `https://help.kusto.windows.net`
///  - `http://127.0.0.1:8080` (tests)     -> kept as-is
pub fn normalize_cluster_url(cluster: &str) -> Result<String> {
    let trimmed = cluster.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other("cluster URL is empty".into()));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else if trimmed.contains('.') || trimmed.contains(':') {
        format!("https://{trimmed}")
    } else {
        // A bare name expands to the public Azure Data Explorer domain.
        format!("https://{trimmed}.kusto.windows.net")
    };
    Ok(with_scheme.trim_end_matches('/').to_string())
}

fn default_headers() -> Vec<(String, String)> {
    vec![
        ("x-ms-app".to_string(), "KustoExplorerMac".to_string()),
        (
            "x-ms-client-request-id".to_string(),
            format!("KE.Mac;{}", request_id()),
        ),
    ]
}

fn request_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

fn describe_http_error(status: u16, body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(err) = value.get("error") {
            if let Some(msg) = err
                .get("@message")
                .and_then(Value::as_str)
                .or_else(|| err.get("message").and_then(Value::as_str))
            {
                return format!("HTTP {status}: {msg}");
            }
        }
    }
    let snippet: String = body.trim().chars().take(300).collect();
    format!("HTTP {status}: {snippet}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AccessToken;
    use chrono::{Duration, Utc};
    use std::sync::Mutex;

    struct StaticTokens;

    #[async_trait]
    impl TokenProvider for StaticTokens {
        async fn get_token(&self, _resource: &str, _tenant: Option<&str>) -> Result<AccessToken> {
            Ok(AccessToken {
                token: "TOKEN".into(),
                expires_on: Utc::now() + Duration::hours(1),
            })
        }
    }

    struct FakeTransport {
        calls: Mutex<Vec<(String, Value)>>,
        response: HttpResponse,
    }

    impl FakeTransport {
        fn new(status: u16, body: &str) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                response: HttpResponse {
                    status,
                    body: body.to_string(),
                },
            }
        }
        fn last_url(&self) -> String {
            self.calls.lock().unwrap().last().unwrap().0.clone()
        }
        fn last_body(&self) -> Value {
            self.calls.lock().unwrap().last().unwrap().1.clone()
        }
    }

    #[async_trait]
    impl HttpTransport for FakeTransport {
        async fn post_json(
            &self,
            url: &str,
            bearer: &str,
            body: Value,
            _headers: &[(String, String)],
        ) -> Result<HttpResponse> {
            assert_eq!(bearer, "TOKEN", "client must send the acquired token");
            self.calls.lock().unwrap().push((url.to_string(), body));
            Ok(self.response.clone())
        }
    }

    fn client_with(transport: Arc<FakeTransport>) -> KustoClient {
        KustoClient::new(transport, Arc::new(StaticTokens))
    }

    #[tokio::test]
    async fn routes_query_to_v2_endpoint() {
        let t = Arc::new(FakeTransport::new(200, include_str!("testdata/v2_count.json")));
        let client = client_with(t.clone());
        let rs = client
            .execute("help", "Samples", "StormEvents | count", None)
            .await
            .unwrap();
        assert_eq!(t.last_url(), "https://help.kusto.windows.net/v2/rest/query");
        assert_eq!(t.last_body()["db"], "Samples");
        assert_eq!(t.last_body()["csl"], "StormEvents | count");
        assert_eq!(rs.row_count, 1);
    }

    #[tokio::test]
    async fn routes_command_to_v1_mgmt_endpoint() {
        let t = Arc::new(FakeTransport::new(
            200,
            include_str!("testdata/v1_databases.json"),
        ));
        let client = client_with(t.clone());
        client
            .execute("help", "NetDefaultDB", ".show databases", None)
            .await
            .unwrap();
        assert_eq!(t.last_url(), "https://help.kusto.windows.net/v1/rest/mgmt");
    }

    #[tokio::test]
    async fn http_error_becomes_kusto_error() {
        let t = Arc::new(FakeTransport::new(400, include_str!("testdata/v2_error.json")));
        let client = client_with(t);
        let err = client.execute("help", "Samples", "bad", None).await.unwrap_err();
        assert_eq!(err.kind(), "kusto");
        assert!(err.to_string().contains("400"));
        assert!(err.to_string().contains("Syntax error"));
    }

    #[test]
    fn normalizes_cluster_urls() {
        assert_eq!(
            normalize_cluster_url("help").unwrap(),
            "https://help.kusto.windows.net"
        );
        assert_eq!(
            normalize_cluster_url("help.kusto.windows.net").unwrap(),
            "https://help.kusto.windows.net"
        );
        assert_eq!(
            normalize_cluster_url("https://help.kusto.windows.net/").unwrap(),
            "https://help.kusto.windows.net"
        );
        assert_eq!(
            normalize_cluster_url("http://127.0.0.1:8080").unwrap(),
            "http://127.0.0.1:8080"
        );
        assert!(normalize_cluster_url("   ").is_err());
    }

    #[test]
    fn detects_management_commands() {
        assert!(is_management_command("  .show databases"));
        assert!(!is_management_command("StormEvents | count"));
    }

    #[test]
    fn quotes_database_names() {
        assert_eq!(quote_database_name("Samples"), "Samples");
        assert_eq!(quote_database_name("_hidden"), "_hidden");
        assert_eq!(quote_database_name("My DB"), "[\"My DB\"]");
        assert_eq!(quote_database_name("a\"b"), "[\"a\\\"b\"]");
        assert_eq!(quote_database_name("1db"), "[\"1db\"]");
    }

    #[tokio::test]
    async fn get_schema_returns_structure_and_raw() {
        // Wrap the small schema fixture as the single-cell result of
        // `.show ... schema as json`.
        let inner = include_str!("testdata/schema_small.json").replace('\n', "");
        let body = serde_json::json!({
            "Tables": [{
                "TableName": "Table_0",
                "Columns": [{"ColumnName": "DatabaseSchema", "ColumnType": "string"}],
                "Rows": [[inner]]
            }]
        })
        .to_string();

        let t = Arc::new(FakeTransport::new(200, &body));
        let client = client_with(t.clone());
        let (structured, raw) = client.get_schema("help", "TestDB", None).await.unwrap();

        assert_eq!(t.last_url(), "https://help.kusto.windows.net/v1/rest/mgmt");
        assert_eq!(t.last_body()["csl"], ".show database TestDB schema as json");
        assert_eq!(structured.name, "TestDB");
        assert_eq!(structured.tables.len(), 2);
        // Raw is preserved for monaco.
        assert!(raw["Databases"]["TestDB"]["Tables"]["Events"].is_object());
    }

    #[tokio::test]
    async fn list_databases_extracts_names() {
        let t = Arc::new(FakeTransport::new(
            200,
            include_str!("testdata/v1_databases.json"),
        ));
        let client = client_with(t.clone());
        let names = client.list_databases("help", None).await.unwrap();
        assert_eq!(t.last_body()["csl"], ".show databases");
        assert!(!names.is_empty());
    }
}
