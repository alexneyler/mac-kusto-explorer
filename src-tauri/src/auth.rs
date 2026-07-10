//! Azure AD token acquisition via the local `az` CLI.
//!
//! The [`TokenProvider`] trait abstracts token acquisition so the rest of the
//! app depends only on the interface. [`AzCliTokenProvider`] is the real
//! implementation; it shells out to `az account get-access-token` and caches
//! results per `(resource, tenant)`. The process invocation itself is hidden
//! behind [`CommandRunner`] so unit tests can inject a fake and avoid touching
//! the real CLI.

use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use chrono::{DateTime, Duration, Local, NaiveDateTime, TimeZone, Utc};
use serde::Deserialize;

use crate::error::{AppError, Result};

/// Safety window: treat a token as expired this many seconds before its actual
/// expiry so a query never starts with a token that dies mid-flight.
const EXPIRY_BUFFER_SECS: i64 = 60;

/// A bearer token plus the instant it stops being valid.
#[derive(Debug, Clone)]
pub struct AccessToken {
    pub token: String,
    pub expires_on: DateTime<Utc>,
}

impl AccessToken {
    /// True when the token is at or within [`EXPIRY_BUFFER_SECS`] of expiry.
    pub fn is_expired(&self, now: DateTime<Utc>) -> bool {
        self.expires_on <= now + Duration::seconds(EXPIRY_BUFFER_SECS)
    }
}

/// Abstraction over acquiring AAD access tokens for a Kusto resource.
#[async_trait]
pub trait TokenProvider: Send + Sync {
    /// Acquire a token for `resource` (a cluster URL such as
    /// `https://help.kusto.windows.net`), optionally scoped to `tenant`.
    async fn get_token(&self, resource: &str, tenant: Option<&str>) -> Result<AccessToken>;
}

/// Captured result of running an external process.
#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Abstraction over spawning a child process, so tests can inject a fake.
#[async_trait]
pub trait CommandRunner: Send + Sync {
    async fn run(&self, program: &str, args: &[String]) -> Result<CommandOutput>;
}

/// Real [`CommandRunner`] backed by `tokio::process::Command`.
pub struct SystemCommandRunner;

#[async_trait]
impl CommandRunner for SystemCommandRunner {
    async fn run(&self, program: &str, args: &[String]) -> Result<CommandOutput> {
        let output = tokio::process::Command::new(program)
            .args(args)
            .output()
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AppError::AzNotFound
                } else {
                    AppError::Io(e.to_string())
                }
            })?;
        Ok(CommandOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// The subset of `az account get-access-token --output json` we consume.
#[derive(Debug, Deserialize)]
struct AzTokenResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    /// Epoch seconds. Present in modern az; timezone-unambiguous, so preferred.
    expires_on: Option<i64>,
    /// Local naive datetime "YYYY-MM-DD HH:MM:SS.ffffff" (fallback only).
    #[serde(rename = "expiresOn")]
    expires_on_local: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Hash, Clone)]
struct CacheKey {
    resource: String,
    tenant: Option<String>,
}

/// Acquires tokens via the Azure CLI, caching them per `(resource, tenant)`.
pub struct AzCliTokenProvider<R: CommandRunner> {
    runner: R,
    cache: Mutex<HashMap<CacheKey, AccessToken>>,
}

impl<R: CommandRunner> AzCliTokenProvider<R> {
    pub fn new(runner: R) -> Self {
        Self {
            runner,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Parse the JSON body of `az account get-access-token --output json`.
    fn parse_response(body: &str) -> Result<AccessToken> {
        let resp: AzTokenResponse = serde_json::from_str(body)
            .map_err(|e| AppError::Auth(format!("could not parse az token output: {e}")))?;

        let expires_on = if let Some(epoch) = resp.expires_on {
            Utc.timestamp_opt(epoch, 0)
                .single()
                .ok_or_else(|| AppError::Auth("invalid expires_on timestamp".into()))?
        } else if let Some(local) = &resp.expires_on_local {
            parse_local_naive(local)?
        } else {
            // No expiry info at all: assume a short life so we refresh soon.
            Utc::now() + Duration::minutes(5)
        };

        Ok(AccessToken {
            token: resp.access_token,
            expires_on,
        })
    }
}

/// Interpret az's local naive `expiresOn` string as local time, then to UTC.
fn parse_local_naive(s: &str) -> Result<DateTime<Utc>> {
    let naive = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f")
        .map_err(|e| AppError::Auth(format!("invalid expiresOn '{s}': {e}")))?;
    let local = Local
        .from_local_datetime(&naive)
        .single()
        .ok_or_else(|| AppError::Auth("ambiguous local expiry".into()))?;
    Ok(local.with_timezone(&Utc))
}

/// Turn az stderr into a friendly, actionable message.
fn az_error_message(stderr: &str) -> String {
    let s = stderr.trim();
    if s.is_empty() {
        "`az account get-access-token` failed with no error output.".to_string()
    } else if s.contains("az login") || s.contains("run 'az login'") || s.contains("AADSTS") {
        format!("{s}\nHint: run `az login` in your terminal, then retry.")
    } else {
        s.to_string()
    }
}

#[async_trait]
impl<R: CommandRunner> TokenProvider for AzCliTokenProvider<R> {
    async fn get_token(&self, resource: &str, tenant: Option<&str>) -> Result<AccessToken> {
        let key = CacheKey {
            resource: resource.to_string(),
            tenant: tenant.map(str::to_string),
        };
        let now = Utc::now();

        // Fast path: a cached, still-valid token. The lock is released before
        // any await below.
        {
            let cache = self.cache.lock().expect("token cache poisoned");
            if let Some(tok) = cache.get(&key) {
                if !tok.is_expired(now) {
                    return Ok(tok.clone());
                }
            }
        }

        let mut args = vec![
            "account".to_string(),
            "get-access-token".to_string(),
            "--resource".to_string(),
            resource.to_string(),
            "--output".to_string(),
            "json".to_string(),
        ];
        if let Some(t) = tenant {
            args.push("--tenant".to_string());
            args.push(t.to_string());
        }

        let output = self.runner.run("az", &args).await?;
        if !output.success {
            return Err(AppError::Auth(az_error_message(&output.stderr)));
        }

        let token = Self::parse_response(&output.stdout)?;
        self.cache
            .lock()
            .expect("token cache poisoned")
            .insert(key, token.clone());
        Ok(token)
    }
}

/// A [`TokenProvider`] that always returns a fixed token. Useful for tests and
/// for callers that already hold a bearer token.
pub struct StaticTokenProvider {
    token: String,
    expires_on: DateTime<Utc>,
}

impl StaticTokenProvider {
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            token: token.into(),
            expires_on: Utc::now() + Duration::hours(1),
        }
    }
}

#[async_trait]
impl TokenProvider for StaticTokenProvider {
    async fn get_token(&self, _resource: &str, _tenant: Option<&str>) -> Result<AccessToken> {
        Ok(AccessToken {
            token: self.token.clone(),
            expires_on: self.expires_on,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    /// Fake runner that records calls and returns queued responses in order.
    struct FakeRunner {
        calls: Mutex<Vec<Vec<String>>>,
        responses: Mutex<VecDeque<Result<CommandOutput>>>,
    }

    impl FakeRunner {
        fn new(responses: Vec<Result<CommandOutput>>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                responses: Mutex::new(responses.into_iter().collect()),
            }
        }

        fn call_count(&self) -> usize {
            self.calls.lock().unwrap().len()
        }

        fn last_args(&self) -> Vec<String> {
            self.calls.lock().unwrap().last().cloned().unwrap_or_default()
        }
    }

    #[async_trait]
    impl CommandRunner for FakeRunner {
        async fn run(&self, _program: &str, args: &[String]) -> Result<CommandOutput> {
            self.calls.lock().unwrap().push(args.to_vec());
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(CommandOutput {
                    success: true,
                    stdout: String::new(),
                    stderr: String::new(),
                }))
        }
    }

    fn ok_token_json(token: &str, expires_epoch: i64) -> CommandOutput {
        CommandOutput {
            success: true,
            stdout: format!(
                r#"{{"accessToken":"{token}","expires_on":{expires_epoch},"expiresOn":"2099-01-01 00:00:00.000000","tokenType":"Bearer"}}"#
            ),
            stderr: String::new(),
        }
    }

    #[test]
    fn is_expired_respects_buffer() {
        let now = Utc::now();
        let almost = AccessToken {
            token: "t".into(),
            expires_on: now + Duration::seconds(30),
        };
        let fresh = AccessToken {
            token: "t".into(),
            expires_on: now + Duration::seconds(600),
        };
        assert!(almost.is_expired(now));
        assert!(!fresh.is_expired(now));
    }

    #[test]
    fn parse_response_prefers_epoch() {
        let out = ok_token_json("abc", 1_783_709_695);
        let tok = AzCliTokenProvider::<FakeRunner>::parse_response(&out.stdout).unwrap();
        assert_eq!(tok.token, "abc");
        assert_eq!(tok.expires_on, Utc.timestamp_opt(1_783_709_695, 0).unwrap());
    }

    #[test]
    fn parse_response_without_expiry_defaults_short() {
        let body = r#"{"accessToken":"abc","tokenType":"Bearer"}"#;
        let tok = AzCliTokenProvider::<FakeRunner>::parse_response(body).unwrap();
        assert_eq!(tok.token, "abc");
        // Defaults to roughly five minutes out.
        assert!(tok.expires_on > Utc::now() + Duration::minutes(4));
        assert!(tok.expires_on < Utc::now() + Duration::minutes(6));
    }

    #[test]
    fn parse_response_rejects_garbage() {
        let err = AzCliTokenProvider::<FakeRunner>::parse_response("not json").unwrap_err();
        assert_eq!(err.kind(), "auth");
    }

    #[tokio::test]
    async fn get_token_returns_and_caches() {
        let future = (Utc::now() + Duration::hours(1)).timestamp();
        let runner = FakeRunner::new(vec![Ok(ok_token_json("tok1", future))]);
        let provider = AzCliTokenProvider::new(runner);

        let a = provider.get_token("https://c.kusto.windows.net", None).await.unwrap();
        let b = provider.get_token("https://c.kusto.windows.net", None).await.unwrap();

        assert_eq!(a.token, "tok1");
        assert_eq!(b.token, "tok1");
        // Second call served from cache — runner invoked only once.
        assert_eq!(provider.runner.call_count(), 1);
    }

    #[tokio::test]
    async fn get_token_refreshes_when_expired() {
        let past = (Utc::now() - Duration::seconds(10)).timestamp();
        let future = (Utc::now() + Duration::hours(1)).timestamp();
        let runner = FakeRunner::new(vec![
            Ok(ok_token_json("stale", past)),
            Ok(ok_token_json("fresh", future)),
        ]);
        let provider = AzCliTokenProvider::new(runner);

        let first = provider.get_token("https://c.kusto.windows.net", None).await.unwrap();
        let second = provider.get_token("https://c.kusto.windows.net", None).await.unwrap();

        assert_eq!(first.token, "stale");
        assert_eq!(second.token, "fresh");
        assert_eq!(provider.runner.call_count(), 2);
    }

    #[tokio::test]
    async fn get_token_passes_tenant_flag() {
        let future = (Utc::now() + Duration::hours(1)).timestamp();
        let runner = FakeRunner::new(vec![Ok(ok_token_json("tok", future))]);
        let provider = AzCliTokenProvider::new(runner);

        provider
            .get_token("https://c.kusto.windows.net", Some("my-tenant"))
            .await
            .unwrap();

        let args = provider.runner.last_args();
        assert!(args.contains(&"--tenant".to_string()));
        assert!(args.contains(&"my-tenant".to_string()));
    }

    #[tokio::test]
    async fn get_token_surfaces_login_hint() {
        let runner = FakeRunner::new(vec![Ok(CommandOutput {
            success: false,
            stdout: String::new(),
            stderr: "Please run 'az login' to setup account.".to_string(),
        })]);
        let provider = AzCliTokenProvider::new(runner);

        let err = provider
            .get_token("https://c.kusto.windows.net", None)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), "auth");
        assert!(err.to_string().contains("az login"));
    }

    #[tokio::test]
    async fn get_token_maps_missing_az() {
        let runner = FakeRunner::new(vec![Err(AppError::AzNotFound)]);
        let provider = AzCliTokenProvider::new(runner);
        let err = provider
            .get_token("https://c.kusto.windows.net", None)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), "az_not_found");
    }
}
