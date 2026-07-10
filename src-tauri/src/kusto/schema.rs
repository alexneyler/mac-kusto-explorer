//! Database schema: extraction from `.show ... schema as json` and a compact,
//! sorted structure used to render the connections tree. The raw
//! `showSchema.Result` is passed straight through to monaco-kusto on the
//! frontend for IntelliSense; this module produces the lightweight tree view.

use serde::Serialize;
use serde_json::Value;

use super::model::KustoResultSet;
use crate::error::{AppError, Result};

/// A column within a table (name + Kusto CSL type).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ColumnSchema {
    pub name: String,
    #[serde(rename = "type")]
    pub column_type: String,
}

/// A table (or view) with its ordered columns.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TableSchema {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(rename = "docString", skip_serializing_if = "Option::is_none")]
    pub doc_string: Option<String>,
    pub columns: Vec<ColumnSchema>,
}

/// A stored function (name + folder + docs; the body is left to monaco).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FunctionSchema {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(rename = "docString", skip_serializing_if = "Option::is_none")]
    pub doc_string: Option<String>,
}

/// A database's tables and functions, sorted for stable display.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DatabaseSchema {
    pub name: String,
    pub tables: Vec<TableSchema>,
    pub functions: Vec<FunctionSchema>,
}

/// Extract database names from a parsed `.show databases` result set.
pub fn database_names(result: &KustoResultSet) -> Vec<String> {
    let Some(idx) = result.columns.iter().position(|c| c.name == "DatabaseName") else {
        return Vec::new();
    };
    let mut names: Vec<String> = result
        .rows
        .iter()
        .filter_map(|r| r.get(idx).and_then(Value::as_str).map(str::to_string))
        .collect();
    names.sort_by_key(|s| s.to_lowercase());
    names.dedup();
    names
}

/// From a `.show ... schema as json` result set, extract and parse the inner
/// `showSchema.Result` JSON (stored as a string in the single result cell).
pub fn extract_schema_json(result: &KustoResultSet) -> Result<Value> {
    let cell = result
        .rows
        .first()
        .and_then(|r| r.first())
        .ok_or_else(|| AppError::Parse("schema result is empty".into()))?;
    let text = cell
        .as_str()
        .ok_or_else(|| AppError::Parse("schema cell is not a string".into()))?;
    serde_json::from_str(text).map_err(|e| AppError::Parse(format!("invalid schema JSON: {e}")))
}

/// Transform a raw `showSchema.Result` into a compact [`DatabaseSchema`] for
/// the given database.
pub fn parse_show_schema(raw: &Value, database: &str) -> Result<DatabaseSchema> {
    let db = raw
        .get("Databases")
        .and_then(|d| d.get(database))
        .ok_or_else(|| AppError::Parse(format!("schema has no database '{database}'")))?;

    let name = db
        .get("Name")
        .and_then(Value::as_str)
        .unwrap_or(database)
        .to_string();

    let mut tables = Vec::new();
    if let Some(tbls) = db.get("Tables").and_then(Value::as_object) {
        for (table_key, table) in tbls {
            let columns = table
                .get("OrderedColumns")
                .and_then(Value::as_array)
                .map(|cols| {
                    cols.iter()
                        .map(|c| ColumnSchema {
                            name: c.get("Name").and_then(Value::as_str).unwrap_or("").to_string(),
                            column_type: c
                                .get("CslType")
                                .and_then(Value::as_str)
                                .or_else(|| c.get("Type").and_then(Value::as_str))
                                .unwrap_or("")
                                .to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            tables.push(TableSchema {
                name: table
                    .get("Name")
                    .and_then(Value::as_str)
                    .unwrap_or(table_key)
                    .to_string(),
                folder: non_empty(table.get("Folder")),
                doc_string: non_empty(table.get("DocString")),
                columns,
            });
        }
    }
    tables.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut functions = Vec::new();
    if let Some(funcs) = db.get("Functions").and_then(Value::as_object) {
        for (func_key, func) in funcs {
            functions.push(FunctionSchema {
                name: func
                    .get("Name")
                    .and_then(Value::as_str)
                    .unwrap_or(func_key)
                    .to_string(),
                folder: non_empty(func.get("Folder")),
                doc_string: non_empty(func.get("DocString")),
            });
        }
    }
    functions.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(DatabaseSchema {
        name,
        tables,
        functions,
    })
}

fn non_empty(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kusto::parser::parse_v1_response;

    const SCHEMA_SMALL: &str = include_str!("testdata/schema_small.json");
    const V1_DATABASES: &str = include_str!("testdata/v1_databases.json");

    #[test]
    fn database_names_extracts_and_sorts() {
        let rs = parse_v1_response(V1_DATABASES).unwrap();
        let names = database_names(&rs);
        assert!(!names.is_empty());
        // Sorted case-insensitively.
        let mut sorted = names.clone();
        sorted.sort_by_key(|s| s.to_lowercase());
        assert_eq!(names, sorted);
    }

    #[test]
    fn database_names_empty_when_column_absent() {
        let rs = KustoResultSet::new(
            vec![crate::kusto::model::KustoColumn::new("Other", "string")],
            vec![vec![serde_json::json!("x")]],
        );
        assert!(database_names(&rs).is_empty());
    }

    #[test]
    fn parse_show_schema_builds_sorted_tree() {
        let raw: Value = serde_json::from_str(SCHEMA_SMALL).unwrap();
        let schema = parse_show_schema(&raw, "TestDB").unwrap();

        assert_eq!(schema.name, "TestDB");
        // Tables sorted: Events, Users.
        assert_eq!(
            schema.tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
            vec!["Events", "Users"]
        );

        let events = &schema.tables[0];
        assert_eq!(events.folder.as_deref(), Some("Raw"));
        assert_eq!(events.doc_string.as_deref(), Some("Raw event stream"));
        assert_eq!(
            events.columns,
            vec![
                ColumnSchema { name: "Timestamp".into(), column_type: "datetime".into() },
                ColumnSchema { name: "Name".into(), column_type: "string".into() },
                ColumnSchema { name: "Count".into(), column_type: "long".into() },
            ]
        );

        // Empty folder/doc become None.
        let users = &schema.tables[1];
        assert_eq!(users.folder, None);
        assert_eq!(users.doc_string, None);

        assert_eq!(schema.functions.len(), 1);
        assert_eq!(schema.functions[0].name, "CountEvents");
        assert_eq!(schema.functions[0].folder.as_deref(), Some("Analytics"));
    }

    #[test]
    fn parse_show_schema_missing_db_errors() {
        let raw: Value = serde_json::from_str(SCHEMA_SMALL).unwrap();
        let err = parse_show_schema(&raw, "NoSuchDb").unwrap_err();
        assert_eq!(err.kind(), "parse");
    }

    #[test]
    fn extract_schema_json_reads_inner_cell() {
        let inner = SCHEMA_SMALL.replace('\n', "");
        let rs = KustoResultSet::new(
            vec![crate::kusto::model::KustoColumn::new("Schema", "string")],
            vec![vec![Value::String(inner)]],
        );
        let raw = extract_schema_json(&rs).unwrap();
        assert!(raw.get("Databases").is_some());
    }

    #[test]
    fn extract_schema_json_empty_errors() {
        let rs = KustoResultSet::empty();
        assert_eq!(extract_schema_json(&rs).unwrap_err().kind(), "parse");
    }
}
