use std::sync::Arc;

use async_trait::async_trait;
use github_copilot_sdk::tool::ToolHandler;
use github_copilot_sdk::types::{Tool, ToolInvocation, ToolResult, ToolResultExpanded};
use github_copilot_sdk::{Error, ErrorKind};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::agent_bridge::AgentBridge;

pub const ALLOWED_AGENT_TOOLS: &[&str] = &[
    "connect_to_database",
    "get_focused_tab",
    "list_query_tabs",
    "get_database_schema",
    "get_table_schema",
    "search_schema",
    "open_query_tab",
    "replace_query_text",
    "append_query_text",
    "focus_query_tab",
];

#[derive(Clone)]
struct WorkspaceTool {
    name: &'static str,
    app: AppHandle,
    bridge: AgentBridge,
}

#[async_trait]
impl ToolHandler for WorkspaceTool {
    async fn call(&self, invocation: ToolInvocation) -> Result<ToolResult, Error> {
        if !is_allowed_tool(self.name) {
            return Err(Error::with_message(
                ErrorKind::InvalidConfig,
                format!("tool '{}' is not allowed", self.name),
            ));
        }
        let result = self
            .bridge
            .request(&self.app, self.name, invocation.arguments)
            .await;
        Ok(match result {
            Ok(value) => ToolResult::Text(json!({ "ok": true, "value": value }).to_string()),
            Err(error) => ToolResult::Expanded(
                ToolResultExpanded::new(
                    json!({ "ok": false, "error": error }).to_string(),
                    "failure",
                )
                .with_error(error),
            ),
        })
    }
}

pub fn is_allowed_tool(name: &str) -> bool {
    ALLOWED_AGENT_TOOLS.contains(&name)
}

pub fn workspace_tools(app: AppHandle, bridge: AgentBridge) -> Vec<Tool> {
    vec![
        tool(
            &app,
            &bridge,
            "connect_to_database",
            "Connect the focused query tab to a Kusto cluster/database and preload its structured schema metadata. This may add the cluster to the app's saved connections, but never executes KQL or reads database rows.",
            object_schema(
                json!({
                    "clusterUrl": {
                        "type": "string",
                        "description": "Kusto cluster URL or short cluster name."
                    },
                    "database": { "type": "string" },
                    "name": {
                        "type": ["string", "null"],
                        "description": "Optional display name for a new connection."
                    },
                    "tenant": {
                        "type": ["string", "null"],
                        "description": "Optional Azure tenant override."
                    }
                }),
                &["clusterUrl", "database"],
            ),
        ),
        tool(
            &app,
            &bridge,
            "get_focused_tab",
            "Read the focused query tab's ID, title, KQL text, revision, cluster identity, and database. Query results are never returned.",
            object_schema(json!({}), &[]),
        ),
        tool(
            &app,
            &bridge,
            "list_query_tabs",
            "List query tab IDs, titles, revisions, and cluster/database associations. Query text and results are not returned.",
            object_schema(json!({}), &[]),
        ),
        tool(
            &app,
            &bridge,
            "get_database_schema",
            "Read structured schema metadata for an accessible Kusto database. This returns entity and column metadata, never database rows.",
            object_schema(
                json!({
                    "clusterId": { "type": "string" },
                    "database": { "type": "string" }
                }),
                &["clusterId", "database"],
            ),
        ),
        tool(
            &app,
            &bridge,
            "get_table_schema",
            "Read schema metadata and effective personal context for one table-like entity. This never reads table rows.",
            object_schema(
                json!({
                    "clusterId": { "type": "string" },
                    "database": { "type": "string" },
                    "entityKind": {
                        "type": "string",
                        "enum": ["table", "materializedView", "externalTable"]
                    },
                    "entityName": { "type": "string" }
                }),
                &["clusterId", "database", "entityKind", "entityName"],
            ),
        ),
        tool(
            &app,
            &bridge,
            "search_schema",
            "Search names and documentation in structured schema metadata. This never searches database rows.",
            object_schema(
                json!({
                    "clusterId": { "type": "string" },
                    "database": { "type": "string" },
                    "query": { "type": "string" }
                }),
                &["clusterId", "database", "query"],
            ),
        ),
        tool(
            &app,
            &bridge,
            "open_query_tab",
            "Create and focus a query tab. This writes KQL into the editor but does not execute it.",
            object_schema(
                json!({
                    "title": { "type": "string" },
                    "query": { "type": "string" },
                    "clusterId": { "type": ["string", "null"] },
                    "database": { "type": ["string", "null"] }
                }),
                &["title", "query"],
            ),
        ),
        tool(
            &app,
            &bridge,
            "replace_query_text",
            "Replace a tab's KQL if its revision still matches. This does not execute the query.",
            object_schema(
                json!({
                    "tabId": { "type": "string" },
                    "query": { "type": "string" },
                    "expectedRevision": { "type": "integer", "minimum": 0 }
                }),
                &["tabId", "query", "expectedRevision"],
            ),
        ),
        tool(
            &app,
            &bridge,
            "append_query_text",
            "Append KQL to a tab if its revision still matches. This does not execute the query.",
            object_schema(
                json!({
                    "tabId": { "type": "string" },
                    "query": { "type": "string" },
                    "expectedRevision": { "type": "integer", "minimum": 0 }
                }),
                &["tabId", "query", "expectedRevision"],
            ),
        ),
        tool(
            &app,
            &bridge,
            "focus_query_tab",
            "Focus an existing query tab without changing or executing its KQL.",
            object_schema(
                json!({ "tabId": { "type": "string" } }),
                &["tabId"],
            ),
        ),
    ]
}

fn tool(
    app: &AppHandle,
    bridge: &AgentBridge,
    name: &'static str,
    description: &'static str,
    parameters: Value,
) -> Tool {
    Tool::new(name)
        .with_description(description)
        .with_parameters(parameters)
        .with_handler(Arc::new(WorkspaceTool {
            name,
            app: app.clone(),
            bridge: bridge.clone(),
        }))
}

fn object_schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false
    })
}

pub fn available_tool_filters() -> Result<Vec<String>, Error> {
    let mut filters = github_copilot_sdk::mode::ToolSet::new();
    for name in ALLOWED_AGENT_TOOLS {
        filters = filters.add_custom(name)?;
    }
    Ok(filters.into_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn allowlist_is_exact_and_unique() {
        let tools = ALLOWED_AGENT_TOOLS.iter().copied().collect::<HashSet<_>>();
        assert_eq!(tools.len(), ALLOWED_AGENT_TOOLS.len());
        for forbidden in ["run_query", "bash", "powershell", "read_file", "web_fetch"] {
            assert!(!is_allowed_tool(forbidden));
        }
    }

    #[test]
    fn filters_are_custom_and_source_qualified() {
        let filters = available_tool_filters().unwrap();
        assert_eq!(filters.len(), ALLOWED_AGENT_TOOLS.len());
        assert!(filters.iter().all(|filter| filter.starts_with("custom:")));
    }
}
