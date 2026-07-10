//! Output formatting: CSV (for export) and Markdown (for share-to-clipboard),
//! plus the composite "share" text. All functions here are pure and heavily
//! tested; the Tauri command layer is a thin wrapper over them.

use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

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
    }
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

fn md_escape(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ").replace('\r', " ")
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
