//! Tauri command layer — thin, `async` wrappers over the tested client and
//! formatter functions. Every command returns `Result<_, AppError>`, which
//! serializes to `{ kind, message }` for the frontend.

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::error::Result;
use crate::kusto::format::{self, ShareMode};
use crate::kusto::model::KustoResultSet;
use crate::kusto::schema::DatabaseSchema;
use crate::state::AppState;

/// A query result plus how long the round-trip took (measured server-side of
/// the app: token (cached) + HTTP + parse).
#[derive(Debug, Serialize)]
pub struct QueryResponse {
    #[serde(flatten)]
    pub result: KustoResultSet,
    pub elapsed_ms: u64,
}

/// Structured schema tree plus the raw `showSchema.Result` payload that
/// monaco-kusto consumes for IntelliSense.
#[derive(Debug, Serialize)]
pub struct SchemaResponse {
    pub database: DatabaseSchema,
    pub raw: Value,
}

/// Run a KQL query (or `.`-prefixed management command) against a database.
#[tauri::command]
pub async fn run_query(
    state: State<'_, AppState>,
    cluster: String,
    database: String,
    query: String,
    tenant: Option<String>,
) -> Result<QueryResponse> {
    let start = std::time::Instant::now();
    let result = state
        .client
        .execute(&cluster, &database, &query, tenant.as_deref())
        .await?;
    let elapsed_ms = start.elapsed().as_millis() as u64;
    Ok(QueryResponse { result, elapsed_ms })
}

/// List database names available on a cluster.
#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    cluster: String,
    tenant: Option<String>,
) -> Result<Vec<String>> {
    state.client.list_databases(&cluster, tenant.as_deref()).await
}

/// Fetch a database's schema (structured tree + raw payload for IntelliSense).
#[tauri::command]
pub async fn get_schema(
    state: State<'_, AppState>,
    cluster: String,
    database: String,
    tenant: Option<String>,
) -> Result<SchemaResponse> {
    let (database_schema, raw) = state
        .client
        .get_schema(&cluster, &database, tenant.as_deref())
        .await?;
    Ok(SchemaResponse {
        database: database_schema,
        raw,
    })
}

/// Build clipboard text for the Share button (query / results / both).
#[tauri::command]
pub fn format_share(mode: ShareMode, query: String, result: KustoResultSet) -> String {
    format::share_text(mode, &query, &result)
}

/// Write the given result set to `path` as CSV.
#[tauri::command]
pub fn export_csv(path: String, result: KustoResultSet) -> Result<()> {
    format::write_csv_file(std::path::Path::new(&path), &result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kusto::model::KustoColumn;
    use serde_json::json;

    #[test]
    fn query_response_flattens_result_and_adds_elapsed() {
        let resp = QueryResponse {
            result: KustoResultSet::new(
                vec![KustoColumn::new("c", "long")],
                vec![vec![json!(1)]],
            ),
            elapsed_ms: 7,
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["columns"][0]["name"], "c");
        assert_eq!(v["columns"][0]["type"], "long");
        assert_eq!(v["rows"][0][0], 1);
        assert_eq!(v["row_count"], 1);
        assert_eq!(v["elapsed_ms"], 7);
    }
}
