use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A single result column: its name and Kusto scalar type
/// (e.g. `string`, `long`, `datetime`, `dynamic`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KustoColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub column_type: String,
}

impl KustoColumn {
    pub fn new(name: impl Into<String>, column_type: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            column_type: column_type.into(),
        }
    }
}

/// A tabular result: columns and rows of raw JSON cell values. Cell values keep
/// their native JSON type (number, string, bool, null, or nested dynamic).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KustoResultSet {
    pub columns: Vec<KustoColumn>,
    pub rows: Vec<Vec<Value>>,
    #[serde(default)]
    pub row_count: usize,
}

impl KustoResultSet {
    pub fn new(columns: Vec<KustoColumn>, rows: Vec<Vec<Value>>) -> Self {
        let row_count = rows.len();
        Self {
            columns,
            rows,
            row_count,
        }
    }

    pub fn empty() -> Self {
        Self {
            columns: Vec::new(),
            rows: Vec::new(),
            row_count: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn new_tracks_row_count() {
        let rs = KustoResultSet::new(
            vec![KustoColumn::new("n", "long")],
            vec![vec![json!(1)], vec![json!(2)]],
        );
        assert_eq!(rs.row_count, 2);
    }

    #[test]
    fn serializes_column_type_as_type() {
        let json = serde_json::to_value(KustoColumn::new("c", "string")).unwrap();
        assert_eq!(json["name"], "c");
        assert_eq!(json["type"], "string");
    }

    #[test]
    fn empty_is_empty() {
        let rs = KustoResultSet::empty();
        assert_eq!(rs.row_count, 0);
        assert!(rs.columns.is_empty());
    }
}
