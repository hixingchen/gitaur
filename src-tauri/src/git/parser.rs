use serde::Serialize;

/// Parsed file status entry
#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub status: char,       // M=modified, A=added, D=deleted, R=renamed, ?=untracked
    pub staged: bool,
}

/// Parse `git status --porcelain` output into structured data
/// 解析 git status 输出的文件路径（处理引号和八进制转义）
fn decode_git_path(raw: &str) -> String {
    let trimmed = raw.trim();
    // 如果路径被引号包围，去掉引号并解码八进制转义
    if trimmed.starts_with('"') && trimmed.ends_with('"') {
        let inner = &trimmed[1..trimmed.len() - 1];
        let mut result = Vec::new();
        let bytes: Vec<u8> = inner.bytes().collect();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'\\' && i + 3 < bytes.len() {
                // 检查是否是八进制转义（\xxx）
                let b1 = bytes[i + 1];
                let b2 = bytes[i + 2];
                let b3 = bytes[i + 3];
                if b1 >= b'0' && b1 <= b'3' && b2 >= b'0' && b2 <= b'7' && b3 >= b'0' && b3 <= b'7' {
                    let val = (b1 - b'0') * 64 + (b2 - b'0') * 8 + (b3 - b'0');
                    result.push(val);
                    i += 4;
                    continue;
                }
            }
            result.push(bytes[i]);
            i += 1;
        }
        String::from_utf8_lossy(&result).to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn parse_status(raw: &str) -> Vec<FileStatus> {
    raw.lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let chars: Vec<char> = line.chars().collect();
            let index_status = chars[0];
            let worktree_status = chars[1];
            let path = decode_git_path(&line[3..]);

            // M/A/D/R in index → staged；'?' or ' ' → unstaged
            let staged = index_status != ' ' && index_status != '?';
            let status = if staged { index_status } else { worktree_status };

            Some(FileStatus { path, status, staged })
        })
        .collect()
}

/// Parsed branch info
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub is_current: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
}

/// Parse `git branch -vv` output
pub fn parse_branches(raw: &str) -> Vec<Branch> {
    raw.lines()
        .filter_map(|line| {
            let is_current = line.starts_with('*');
            let cleaned = if is_current { &line[2..] } else { line.trim() };

            let parts: Vec<&str> = cleaned.split_whitespace().collect();
            if parts.is_empty() {
                return None;
            }

            let name = parts[0].to_string();

            let (upstream, ahead, behind) = if parts.len() > 2 && parts[1] == "->" {
                // 符号引用（如 remotes/origin/HEAD -> origin/main），不是实际分支，跳过
                return None;
            } else {
                // Check for [origin/main: ahead N, behind M]
                let bracket_part = parts.last().unwrap_or(&"");
                if bracket_part.starts_with('[') && bracket_part.ends_with(']') {
                    let inner = &bracket_part[1..bracket_part.len() - 1];
                    let upstream_name = inner
                        .split(':')
                        .next()
                        .map(|s| s.to_string());
                    let ahead = extract_number(inner, "ahead");
                    let behind = extract_number(inner, "behind");
                    (upstream_name, ahead, behind)
                } else {
                    (None, 0, 0)
                }
            };

            Some(Branch { name, is_current, upstream, ahead, behind })
        })
        .collect()
}

fn extract_number(s: &str, key: &str) -> usize {
    s.split_whitespace()
        .collect::<Vec<&str>>()
        .windows(2)
        .find(|w| w[0] == key)
        .and_then(|w| w[1].parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_status() {
        let input = " M src/main.rs\n?? README.md\nA  Cargo.toml\n";
        let result = parse_status(input);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].path, "src/main.rs");
        assert_eq!(result[0].status, 'M');
        assert!(result[0].staged);
    }

    #[test]
    fn test_parse_status_empty() {
        let result = parse_status("");
        assert!(result.is_empty());
    }
}
