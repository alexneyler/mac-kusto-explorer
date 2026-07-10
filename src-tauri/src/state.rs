//! Shared application state: a single Kusto client wired to the real
//! `az`-CLI token provider and reqwest transport.

use std::sync::Arc;

use crate::auth::{AzCliTokenProvider, SystemCommandRunner, TokenProvider};
use crate::kusto::{KustoClient, ReqwestTransport};

/// Long-lived state managed by Tauri and shared across command invocations.
pub struct AppState {
    pub client: KustoClient,
}

impl AppState {
    pub fn new() -> Self {
        let tokens: Arc<dyn TokenProvider> =
            Arc::new(AzCliTokenProvider::new(SystemCommandRunner));
        let transport = Arc::new(ReqwestTransport::new());
        Self {
            client: KustoClient::new(transport, tokens),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
