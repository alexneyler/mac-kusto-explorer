//! Output formatting: CSV (for export) and Markdown (for share-to-clipboard),
//! plus the composite "share" text. All functions here are pure and heavily
//! tested; the Tauri command layer is a thin wrapper over them.

use std::path::Path;

use serde::Deserialize;
use serde_json::{Map, Value};

use super::model::KustoResultSet;
use crate::error::Result;

/// What to include when sharing to the clipboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShareMode {
    /// Just the KQL query text.
    Query,
    /// Just the results, as a Markdown table.
    Results,
    /// The query (as a fenced code block) followed by the results table.
    Both,
    /// Just the results, as a JSON array of row objects.
    Json,
    /// Just the results, as tab-separated values (paste into Excel).
    Tsv,
    /// Just the results, as a KQL `datatable(...)` literal (paste into a query).
    Datatable,
}

/// A file export format selectable from the Export menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    /// RFC 4180 CSV.
    Csv,
    /// JSON array of row objects.
    Json,
    /// Tab-separated values (Excel-friendly).
    Tsv,
}

impl ExportFormat {
    /// Render a result set to this format's text representation.
    pub fn render(self, result: &KustoResultSet) -> String {
        match self {
            ExportFormat::Csv => to_csv(result),
            ExportFormat::Json => to_json(result),
            ExportFormat::Tsv => to_tsv(result),
        }
    }

    /// The conventional file extension for this format (no leading dot).
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Csv => "csv",
            ExportFormat::Json => "json",
            ExportFormat::Tsv => "tsv",
        }
    }
}

/// Render a single JSON cell value as display text.
pub fn cell_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        // Dynamic (arrays/objects) render as compact JSON.
        other => other.to_string(),
    }
}

/// Render a result set as RFC 4180 CSV (CRLF line endings, quoted as needed).
pub fn to_csv(result: &KustoResultSet) -> String {
    let mut out = String::new();
    let header = result
        .columns
        .iter()
        .map(|c| csv_escape(&c.name))
        .collect::<Vec<_>>()
        .join(",");
    out.push_str(&header);
    out.push_str("\r\n");

    for row in &result.rows {
        let line = (0..result.columns.len())
            .map(|i| csv_escape(&row.get(i).map(cell_to_string).unwrap_or_default()))
            .collect::<Vec<_>>()
            .join(",");
        out.push_str(&line);
        out.push_str("\r\n");
    }
    out
}

/// Render a result set as a GitHub-flavored Markdown table.
pub fn to_markdown(result: &KustoResultSet) -> String {
    if result.columns.is_empty() {
        return String::new();
    }
    let mut out = String::new();

    let header = result
        .columns
        .iter()
        .map(|c| md_escape(&c.name))
        .collect::<Vec<_>>()
        .join(" | ");
    out.push_str(&format!("| {header} |\n"));

    let sep = result
        .columns
        .iter()
        .map(|_| "---")
        .collect::<Vec<_>>()
        .join(" | ");
    out.push_str(&format!("| {sep} |\n"));

    for row in &result.rows {
        let line = (0..result.columns.len())
            .map(|i| md_escape(&row.get(i).map(cell_to_string).unwrap_or_default()))
            .collect::<Vec<_>>()
            .join(" | ");
        out.push_str(&format!("| {line} |\n"));
    }
    out
}

/// Build the clipboard text for a share action.
pub fn share_text(mode: ShareMode, query: &str, result: &KustoResultSet) -> String {
    match mode {
        ShareMode::Query => query.trim().to_string(),
        ShareMode::Results => to_markdown(result),
        ShareMode::Both => format!("```kql\n{}\n```\n\n{}", query.trim(), to_markdown(result)),
        ShareMode::Json => to_json(result),
        ShareMode::Tsv => to_tsv(result),
        ShareMode::Datatable => to_datatable(result),
    }
}

/// Render a result set as a JSON array of row objects (one object per row,
/// keyed by column name, cell values keeping their native JSON type).
pub fn to_json(result: &KustoResultSet) -> String {
    let rows: Vec<Value> = result
        .rows
        .iter()
        .map(|row| {
            let mut obj = Map::new();
            for (i, col) in result.columns.iter().enumerate() {
                let value = row.get(i).cloned().unwrap_or(Value::Null);
                obj.insert(col.name.clone(), value);
            }
            Value::Object(obj)
        })
        .collect();
    // `preserve_order` keeps columns in their original order.
    serde_json::to_string_pretty(&Value::Array(rows)).unwrap_or_else(|_| "[]".to_string())
}

/// Render a result set as tab-separated values (a header row plus data rows).
/// Tabs and newlines inside cells are collapsed to spaces so the output pastes
/// cleanly into Excel and other spreadsheet tools.
pub fn to_tsv(result: &KustoResultSet) -> String {
    let mut out = String::new();
    let header = result
        .columns
        .iter()
        .map(|c| tsv_escape(&c.name))
        .collect::<Vec<_>>()
        .join("\t");
    out.push_str(&header);
    out.push_str("\r\n");

    for row in &result.rows {
        let line = (0..result.columns.len())
            .map(|i| tsv_escape(&row.get(i).map(cell_to_string).unwrap_or_default()))
            .collect::<Vec<_>>()
            .join("\t");
        out.push_str(&line);
        out.push_str("\r\n");
    }
    out
}

/// Render a result set as a KQL `datatable(...)` literal that can be pasted back
/// into a query. Each value is rendered as a typed KQL literal based on its
/// column type and JSON value.
pub fn to_datatable(result: &KustoResultSet) -> String {
    if result.columns.is_empty() {
        return String::new();
    }

    let header = result
        .columns
        .iter()
        .map(|c| format!("{}: {}", c.name, c.column_type))
        .collect::<Vec<_>>()
        .join(", ");

    let mut out = format!("datatable ({header}) [\n");
    for row in &result.rows {
        let cells = (0..result.columns.len())
            .map(|i| {
                let col = &result.columns[i];
                let value = row.get(i).unwrap_or(&Value::Null);
                datatable_value(&col.column_type, value)
            })
            .collect::<Vec<_>>()
            .join(", ");
        out.push_str(&format!("    {cells},\n"));
    }
    out.push(']');
    out
}

/// Write a result set to `path` in the given export format.
pub fn write_export_file(path: &Path, format: ExportFormat, result: &KustoResultSet) -> Result<()> {
    std::fs::write(path, format.render(result))?;
    Ok(())
}

/// Write a result set to `path` as CSV.
pub fn write_csv_file(path: &Path, result: &KustoResultSet) -> Result<()> {
    std::fs::write(path, to_csv(result))?;
    Ok(())
}

fn csv_escape(field: &str) -> String {
    if field.contains(|c: char| c == ',' || c == '"' || c == '\n' || c == '\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

fn tsv_escape(field: &str) -> String {
    field
        .replace(['\t', '\n', '\r'], " ")
}

fn md_escape(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ").replace('\r', " ")
}

/// A KQL string literal: double-quoted with backslash and quote escaped.
fn kql_string_literal(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Render a single cell as a typed KQL literal for a `datatable`, based on the
/// column's Kusto type and the JSON value.
fn datatable_value(col_type: &str, value: &Value) -> String {
    let ty = col_type.to_ascii_lowercase();
    match value {
        Value::Null => datatable_null(&ty),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::Array(_) | Value::Object(_) => format!("dynamic({value})"),
        Value::String(s) => match ty.as_str() {
            "datetime" | "date" => format!("datetime({s})"),
            "timespan" | "time" => format!("timespan({s})"),
            "guid" | "uuid" | "uniqueid" => format!("guid({s})"),
            "long" | "int" | "real" | "double" | "decimal" => {
                // Numeric column carrying a string value: emit it verbatim if it
                // looks numeric, otherwise fall back to a quoted string.
                if s.parse::<f64>().is_ok() {
                    s.clone()
                } else {
                    kql_string_literal(s)
                }
            }
            "dynamic" => format!("dynamic({})", kql_string_literal(s)),
            _ => kql_string_literal(s),
        },
    }
}

/// The KQL literal for a null cell in a column of the given (lowercased) type.
fn datatable_null(ty: &str) -> String {
    match ty {
        "string" => "\"\"".to_string(),
        "long" | "int" => "long(null)".to_string(),
        "real" | "double" => "real(null)".to_string(),
        "decimal" => "decimal(null)".to_string(),
        "bool" | "boolean" => "bool(null)".to_string(),
        "datetime" | "date" => "datetime(null)".to_string(),
        "timespan" | "time" => "timespan(null)".to_string(),
        "dynamic" => "dynamic(null)".to_string(),
        _ => "\"\"".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kusto::model::KustoColumn;
    use serde_json::json;

    fn sample() -> KustoResultSet {
        KustoResultSet::new(
            vec![
                KustoColumn::new("Name", "string"),
                KustoColumn::new("Count", "long"),
                KustoColumn::new("Extra", "dynamic"),
            ],
            vec![
                vec![json!("alpha"), json!(3), json!({"k": 1})],
                vec![json!("beta"), json!(0), json!([1, 2])],
            ],
        )
    }

    #[test]
    fn cell_to_string_covers_types() {
        assert_eq!(cell_to_string(&Value::Null), "");
        assert_eq!(cell_to_string(&json!("hi")), "hi");
        assert_eq!(cell_to_string(&json!(true)), "true");
        assert_eq!(cell_to_string(&json!(42)), "42");
        assert_eq!(cell_to_string(&json!(1.5)), "1.5");
        assert_eq!(cell_to_string(&json!({"a": 1})), r#"{"a":1}"#);
        assert_eq!(cell_to_string(&json!([1, 2])), "[1,2]");
    }

    #[test]
    fn to_csv_has_header_and_crlf() {
        let csv = to_csv(&sample());
        let lines: Vec<&str> = csv.split("\r\n").collect();
        assert_eq!(lines[0], "Name,Count,Extra");
        assert_eq!(lines[1], r#"alpha,3,"{""k"":1}""#);
        assert_eq!(lines[2], r#"beta,0,"[1,2]""#);
        // Trailing CRLF yields an empty final element.
        assert_eq!(lines[3], "");
    }

    #[test]
    fn csv_escapes_commas_quotes_and_newlines() {
        let rs = KustoResultSet::new(
            vec![KustoColumn::new("c", "string")],
            vec![
                vec![json!("a,b")],
                vec![json!("she said \"hi\"")],
                vec![json!("line1\nline2")],
            ],
        );
        let csv = to_csv(&rs);
        let lines: Vec<&str> = csv.split("\r\n").collect();
        assert_eq!(lines[1], "\"a,b\"");
        assert_eq!(lines[2], "\"she said \"\"hi\"\"\"");
        assert_eq!(lines[3], "\"line1\nline2\"");
    }

    #[test]
    fn to_markdown_builds_table() {
        let md = to_markdown(&sample());
        let expected = "\
| Name | Count | Extra |
| --- | --- | --- |
| alpha | 3 | {\"k\":1} |
| beta | 0 | [1,2] |
";
        assert_eq!(md, expected);
    }

    #[test]
    fn markdown_escapes_pipes_and_newlines() {
        let rs = KustoResultSet::new(
            vec![KustoColumn::new("c", "string")],
            vec![vec![json!("a|b\nc")]],
        );
        let md = to_markdown(&rs);
        assert!(md.contains("a\\|b c"));
    }

    #[test]
    fn markdown_empty_when_no_columns() {
        assert_eq!(to_markdown(&KustoResultSet::empty()), "");
    }

    #[test]
    fn share_text_modes() {
        let rs = sample();
        assert_eq!(share_text(ShareMode::Query, "  StormEvents | count  ", &rs), "StormEvents | count");
        assert_eq!(share_text(ShareMode::Results, "q", &rs), to_markdown(&rs));

        let both = share_text(ShareMode::Both, "StormEvents | count", &rs);
        assert!(both.starts_with("```kql\nStormEvents | count\n```\n\n"));
        assert!(both.contains("| Name | Count | Extra |"));
    }

    #[test]
    fn share_mode_deserializes_from_snake_case() {
        assert_eq!(
            serde_json::from_str::<ShareMode>("\"query\"").unwrap(),
            ShareMode::Query
        );
        assert_eq!(
            serde_json::from_str::<ShareMode>("\"both\"").unwrap(),
            ShareMode::Both
        );
    }

    #[test]
    fn to_json_builds_array_of_objects_in_column_order() {
        let json = to_json(&sample());
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);
        assert_eq!(parsed[0]["Name"], "alpha");
        assert_eq!(parsed[0]["Count"], 3);
        assert_eq!(parsed[0]["Extra"], json!({"k": 1}));
        assert_eq!(parsed[1]["Name"], "beta");
        assert_eq!(parsed[1]["Extra"], json!([1, 2]));
        // Column order is preserved (Name before Count before Extra).
        let first_obj_start = json.find('{').unwrap();
        let name_pos = json[first_obj_start..].find("\"Name\"").unwrap();
        let count_pos = json[first_obj_start..].find("\"Count\"").unwrap();
        assert!(name_pos < count_pos);
    }

    #[test]
    fn to_json_empty_result_is_empty_array() {
        assert_eq!(to_json(&KustoResultSet::empty()), "[]");
    }

    #[test]
    fn to_tsv_has_header_and_tabs() {
        let tsv = to_tsv(&sample());
        let lines: Vec<&str> = tsv.split("\r\n").collect();
        assert_eq!(lines[0], "Name\tCount\tExtra");
        assert_eq!(lines[1], "alpha\t3\t{\"k\":1}");
        assert_eq!(lines[2], "beta\t0\t[1,2]");
        assert_eq!(lines[3], "");
    }

    #[test]
    fn tsv_collapses_tabs_and_newlines() {
        let rs = KustoResultSet::new(
            vec![KustoColumn::new("c", "string")],
            vec![vec![json!("a\tb")], vec![json!("line1\nline2")]],
        );
        let tsv = to_tsv(&rs);
        let lines: Vec<&str> = tsv.split("\r\n").collect();
        assert_eq!(lines[1], "a b");
        assert_eq!(lines[2], "line1 line2");
    }

    #[test]
    fn to_datatable_renders_typed_literals() {
        let dt = to_datatable(&sample());
        let expected = "\
datatable (Name: string, Count: long, Extra: dynamic) [
    \"alpha\", 3, dynamic({\"k\":1}),
    \"beta\", 0, dynamic([1,2]),
]";
        assert_eq!(dt, expected);
    }

    #[test]
    fn datatable_escapes_strings_and_handles_nulls() {
        let rs = KustoResultSet::new(
            vec![
                KustoColumn::new("s", "string"),
                KustoColumn::new("n", "long"),
                KustoColumn::new("b", "bool"),
                KustoColumn::new("d", "datetime"),
            ],
            vec![
                vec![json!("say \"hi\""), Value::Null, json!(true), json!("2020-01-01T00:00:00Z")],
                vec![Value::Null, json!(5), Value::Null, Value::Null],
            ],
        );
        let dt = to_datatable(&rs);
        assert!(dt.contains(r#""say \"hi\"", long(null), true, datetime(2020-01-01T00:00:00Z),"#));
        assert!(dt.contains(r#""", 5, bool(null), datetime(null),"#));
    }

    #[test]
    fn to_datatable_empty_when_no_columns() {
        assert_eq!(to_datatable(&KustoResultSet::empty()), "");
    }

    #[test]
    fn share_text_covers_new_result_formats() {
        let rs = sample();
        assert_eq!(share_text(ShareMode::Json, "q", &rs), to_json(&rs));
        assert_eq!(share_text(ShareMode::Tsv, "q", &rs), to_tsv(&rs));
        assert_eq!(share_text(ShareMode::Datatable, "q", &rs), to_datatable(&rs));
    }

    #[test]
    fn share_mode_deserializes_new_variants() {
        assert_eq!(
            serde_json::from_str::<ShareMode>("\"json\"").unwrap(),
            ShareMode::Json
        );
        assert_eq!(
            serde_json::from_str::<ShareMode>("\"datatable\"").unwrap(),
            ShareMode::Datatable
        );
    }

    #[test]
    fn export_format_render_and_extension() {
        let rs = sample();
        assert_eq!(ExportFormat::Csv.render(&rs), to_csv(&rs));
        assert_eq!(ExportFormat::Json.render(&rs), to_json(&rs));
        assert_eq!(ExportFormat::Tsv.render(&rs), to_tsv(&rs));
        assert_eq!(ExportFormat::Csv.extension(), "csv");
        assert_eq!(ExportFormat::Json.extension(), "json");
        assert_eq!(ExportFormat::Tsv.extension(), "tsv");
    }

    #[test]
    fn export_format_deserializes_from_snake_case() {
        assert_eq!(
            serde_json::from_str::<ExportFormat>("\"tsv\"").unwrap(),
            ExportFormat::Tsv
        );
    }

    #[test]
    fn write_export_file_writes_selected_format() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.json");
        write_export_file(&path, ExportFormat::Json, &sample()).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, to_json(&sample()));
    }

    #[test]
    fn write_csv_file_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");
        write_csv_file(&path, &sample()).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, to_csv(&sample()));
        assert!(contents.starts_with("Name,Count,Extra\r\n"));
    }

    #[test]
    fn result_set_round_trips_through_serde() {
        // Simulates the frontend sending a result back for formatting/export.
        let rs = sample();
        let json = serde_json::to_string(&rs).unwrap();
        let back: KustoResultSet = serde_json::from_str(&json).unwrap();
        assert_eq!(back, rs);
    }
}
