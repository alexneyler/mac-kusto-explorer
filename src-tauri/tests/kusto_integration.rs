//! End-to-end integration test for the Kusto client using a real reqwest
//! transport against an in-process mock HTTP server.

use std::sync::Arc;

use httpmock::prelude::*;
use kusto_explorer_lib::auth::StaticTokenProvider;
use kusto_explorer_lib::kusto::{KustoClient, ReqwestTransport};

const V2_COUNT: &str = include_str!("../src/kusto/testdata/v2_count.json");
const V2_ERROR: &str = include_str!("../src/kusto/testdata/v2_error.json");

#[tokio::test]
async fn executes_query_over_http_and_parses_primary_result() {
    let server = MockServer::start_async().await;
    let mock = server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/v2/rest/query")
                .header_exists("authorization")
                .json_body_partial(r#"{"db":"Samples","csl":"StormEvents | count"}"#);
            then.status(200)
                .header("content-type", "application/json")
                .body(V2_COUNT);
        })
        .await;

    let client = KustoClient::new(
        Arc::new(ReqwestTransport::new()),
        Arc::new(StaticTokenProvider::new("test-token")),
    );

    let rs = client
        .execute(&server.base_url(), "Samples", "StormEvents | count", None)
        .await
        .expect("query should succeed");

    mock.assert_async().await;
    assert_eq!(rs.row_count, 1);
    assert_eq!(rs.columns[0].name, "Count");
    assert_eq!(rs.rows[0][0], serde_json::json!(59066));
}

#[tokio::test]
async fn surfaces_http_400_as_kusto_error() {
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(POST).path("/v2/rest/query");
            then.status(400)
                .header("content-type", "application/json")
                .body(V2_ERROR);
        })
        .await;

    let client = KustoClient::new(
        Arc::new(ReqwestTransport::new()),
        Arc::new(StaticTokenProvider::new("test-token")),
    );

    let err = client
        .execute(&server.base_url(), "Samples", "StormEvents | bad", None)
        .await
        .expect_err("should fail");
    assert_eq!(err.kind(), "kusto");
    assert!(err.to_string().contains("Syntax error"));
}
