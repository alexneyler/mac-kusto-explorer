//! Parsers for Kusto REST responses.
//!
//! Two wire formats are handled:
//!  - **v2** (`/v2/rest/query`): a JSON array of "frames"; the useful data is in
//!    the first `DataTable` frame whose `TableKind` is `PrimaryResult`.
//!  - **v1** (`/v1/rest/mgmt`): a `{ "Tables": [...] }` object; management
//!    commands (`.show ...`) return their data in the first table.

use serde_json::Value;

use super::model::{KustoColumn, KustoResultSet};
use crate::error::{AppError, Result};

/// Parse a Kusto v2 query response into its first `PrimaryResult` table.
pub fn parse_v2_response(body: &str) -> Result<KustoResultSet> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::Parse(format!("invalid v2 response JSON: {e}")))?;

    // A rejected query can return a bare `{ "error": {...} }` object.
    if let Some(err) = value.get("error") {
        return Err(AppError::Kusto(extract_error_object(err)));
    }

    let frames = value
        .as_array()
        .ok_or_else(|| AppError::Parse("expected a JSON array of frames".into()))?;

    // In-band dataset error (HTTP 200 but HasErrors == true).
    for frame in frames {
        if frame_type(frame) == Some("DataSetCompletion")
            && frame.get("HasErrors").and_then(Value::as_bool) == Some(true)
        {
            return Err(AppError::Kusto(extract_oneapi_errors(frame)));
        }
    }

    for frame in frames {
        if frame_type(frame) == Some("DataTable")
            && frame.get("TableKind").and_then(Value::as_str) == Some("PrimaryResult")
        {
            return parse_data_table(frame);
        }
    }

    // A command with no tabular output (rare on the query path) — return empty.
    Ok(KustoResultSet::empty())
}

/// Parse a Kusto v1 management response (`{"Tables":[...]}`) into its first table.
pub fn parse_v1_response(body: &str) -> Result<KustoResultSet> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| AppError::Parse(format!("invalid v1 response JSON: {e}")))?;

    if let Some(err) = value.get("error") {
        return Err(AppError::Kusto(extract_error_object(err)));
    }

    let tables = value
        .get("Tables")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Parse("v1 response missing Tables".into()))?;
    let table = tables
        .first()
        .ok_or_else(|| AppError::Parse("v1 response has no tables".into()))?;

    let columns = table
        .get("Columns")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Parse("v1 table missing Columns".into()))?
        .iter()
        .map(|c| {
            KustoColumn::new(
                c.get("ColumnName").and_then(Value::as_str).unwrap_or(""),
                c.get("ColumnType")
                    .and_then(Value::as_str)
                    .or_else(|| c.get("DataType").and_then(Value::as_str))
                    .unwrap_or(""),
            )
        })
        .collect::<Vec<_>>();

    let rows = extract_rows(table)?;
    Ok(KustoResultSet::new(columns, rows))
}

fn frame_type(frame: &Value) -> Option<&str> {
    frame.get("FrameType").and_then(Value::as_str)
}

fn parse_data_table(frame: &Value) -> Result<KustoResultSet> {
    let columns = frame
        .get("Columns")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Parse("DataTable missing Columns".into()))?
        .iter()
        .map(|c| {
            KustoColumn::new(
                c.get("ColumnName").and_then(Value::as_str).unwrap_or(""),
                c.get("ColumnType").and_then(Value::as_str).unwrap_or(""),
            )
        })
        .collect::<Vec<_>>();
    let rows = extract_rows(frame)?;
    Ok(KustoResultSet::new(columns, rows))
}

fn extract_rows(table: &Value) -> Result<Vec<Vec<Value>>> {
    Ok(table
        .get("Rows")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Parse("table missing Rows".into()))?
        .iter()
        .map(|r| r.as_array().cloned().unwrap_or_default())
        .collect())
}

fn extract_error_object(err: &Value) -> String {
    err.get("@message")
        .and_then(Value::as_str)
        .or_else(|| err.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| err.to_string())
}

fn extract_oneapi_errors(frame: &Value) -> String {
    frame
        .get("OneApiErrors")
        .and_then(Value::as_array)
        .and_then(|errors| errors.first())
        .and_then(|first| first.get("error"))
        .map(extract_error_object)
        .unwrap_or_else(|| "query failed with errors".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const V2_COUNT: &str = include_str!("testdata/v2_count.json");
    const V2_ROWS: &str = include_str!("testdata/v2_rows.json");
    const V2_ERROR: &str = include_str!("testdata/v2_error.json");
    const V1_DATABASES: &str = include_str!("testdata/v1_databases.json");

    #[test]
    fn parses_v2_count() {
        let rs = parse_v2_response(V2_COUNT).unwrap();
        assert_eq!(rs.columns, vec![KustoColumn::new("Count", "long")]);
        assert_eq!(rs.row_count, 1);
        assert_eq!(rs.rows[0][0], json!(59066));
    }

    #[test]
    fn parses_v2_rows_preserving_types() {
        let rs = parse_v2_response(V2_ROWS).unwrap();
        let types: Vec<&str> = rs.columns.iter().map(|c| c.column_type.as_str()).collect();
        assert_eq!(
            types,
            vec!["datetime", "string", "int", "real", "bool", "dynamic"]
        );
        assert_eq!(rs.row_count, 2);
        let row = &rs.rows[0];
        assert_eq!(row[1], json!("INDIANA"));
        assert_eq!(row[4], json!(true));
        // Dynamic column preserves nested structure.
        assert_eq!(row[5]["arr"], json!([1, 2]));
    }

    #[test]
    fn v2_error_object_becomes_kusto_error() {
        let err = parse_v2_response(V2_ERROR).unwrap_err();
        assert_eq!(err.kind(), "kusto");
        assert!(err.to_string().contains("Syntax error"));
    }

    #[test]
    fn v2_dataset_completion_error() {
        let body = r#"[{"FrameType":"DataSetHeader"},{"FrameType":"DataSetCompletion","HasErrors":true,"OneApiErrors":[{"error":{"message":"boom","@message":"detailed boom"}}]}]"#;
        let err = parse_v2_response(body).unwrap_err();
        assert!(err.to_string().contains("detailed boom"));
    }

    #[test]
    fn v2_no_primary_result_is_empty() {
        let body = r#"[{"FrameType":"DataSetHeader"},{"FrameType":"DataSetCompletion","HasErrors":false}]"#;
        let rs = parse_v2_response(body).unwrap();
        assert_eq!(rs, KustoResultSet::empty());
    }

    #[test]
    fn v2_rejects_non_array() {
        let err = parse_v2_response(r#"{"foo":1}"#).unwrap_err();
        assert_eq!(err.kind(), "parse");
    }

    #[test]
    fn parses_v1_databases() {
        let rs = parse_v1_response(V1_DATABASES).unwrap();
        assert_eq!(rs.columns[0], KustoColumn::new("DatabaseName", "string"));
        assert!(rs.row_count >= 1);
        assert!(rs.rows[0][0].is_string());
    }

    #[test]
    fn v1_error_object_becomes_kusto_error() {
        let body = r#"{"error":{"code":"Bad","message":"nope"}}"#;
        let err = parse_v1_response(body).unwrap_err();
        assert_eq!(err.kind(), "kusto");
        assert!(err.to_string().contains("nope"));
    }
}
