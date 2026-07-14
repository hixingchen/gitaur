pub mod executor;
pub mod parser;

/// Unified output from git command execution
#[derive(Debug, Clone)]
pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

impl GitOutput {
    pub fn is_success(&self) -> bool {
        self.exit_code == 0
    }

    pub fn error_message(&self) -> Option<&str> {
        if self.is_success() {
            None
        } else {
            Some(if self.stderr.is_empty() { &self.stdout } else { &self.stderr })
        }
    }
}
