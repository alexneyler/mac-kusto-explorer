use serde::Serialize;

/// Convenience result type used throughout the backend.
pub type Result<T> = std::result::Result<T, AppError>;

/// Application-level error. Serializes to `{ kind, message }` for the frontend.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("The Azure CLI (`az`) was not found on your PATH. Install it and run `az login`.")]
    AzNotFound,

    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Network error: {0}")]
    Http(String),

    #[error("Kusto service error: {0}")]
    Kusto(String),

    #[error("Failed to parse response: {0}")]
    Parse(String),

    #[error("I/O error: {0}")]
    Io(String),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// Stable machine-readable discriminator for the frontend.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::AzNotFound => "az_not_found",
            AppError::Auth(_) => "auth",
            AppError::Http(_) => "http",
            AppError::Kusto(_) => "kusto",
            AppError::Parse(_) => "parse",
            AppError::Io(_) => "io",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Http(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Parse(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_and_message() {
        let err = AppError::Auth("no login".into());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "auth");
        assert_eq!(json["message"], "Authentication failed: no login");
    }

    #[test]
    fn az_not_found_has_helpful_message() {
        let err = AppError::AzNotFound;
        assert!(err.to_string().contains("az login"));
        assert_eq!(err.kind(), "az_not_found");
    }
}
