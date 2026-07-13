use thiserror::Error;

#[derive(Error, Debug)]
pub enum GitError {
    #[error("Git is not installed or not found in PATH")]
    NotFound,

    #[error("Not a git repository: {0}")]
    NotARepo(String),

    #[error("Git command failed (exit={exit_code}): {stderr}")]
    CommandFailed { exit_code: i32, stderr: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("UTF-8 decode error: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),

    #[error("Operation timed out")]
    Timeout,

    #[error("Operation cancelled")]
    Cancelled,
}

pub type Result<T> = std::result::Result<T, GitError>;
