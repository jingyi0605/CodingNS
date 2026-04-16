use serde::Serialize;
#[cfg(target_os = "windows")]
use serde::Deserialize;
use std::process::Command;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3002;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLocalHostProcessHit {
    pub pid: u32,
    pub command_line: String,
    pub executable: Option<String>,
    pub source: LocalHostProcessSource,
    pub base_url: Option<String>,
    pub port: Option<u16>,
    pub data_dir: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalHostProcessSource {
    Codingns,
    Npm,
    Npx,
    Node,
}

#[derive(Debug, Clone)]
struct LocalProcessEntry {
    pid: u32,
    executable: Option<String>,
    command_line: String,
}

#[derive(Debug, Clone)]
struct ParsedHostCommand {
    source: LocalHostProcessSource,
    base_url: String,
    port: u16,
    data_dir: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WindowsProcessEntry {
    process_id: u32,
    executable_path: Option<String>,
    command_line: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum WindowsProcessPayload {
    One(WindowsProcessEntry),
    Many(Vec<WindowsProcessEntry>),
}

pub fn scan_local_hosts() -> Result<Vec<DesktopLocalHostProcessHit>, String> {
    let processes = collect_process_entries()?;
    let mut hits = Vec::new();

    for process in processes {
        let Some(parsed) = parse_host_process(&process) else {
            continue;
        };

        hits.push(DesktopLocalHostProcessHit {
            pid: process.pid,
            command_line: process.command_line,
            executable: process.executable,
            source: parsed.source,
            base_url: Some(parsed.base_url),
            port: Some(parsed.port),
            data_dir: parsed.data_dir,
        });
    }

    Ok(hits)
}

#[cfg(target_os = "macos")]
fn collect_process_entries() -> Result<Vec<LocalProcessEntry>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,comm=,command="])
        .output()
        .map_err(|error| format!("执行 ps 失败: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "读取进程列表失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8(output.stdout).map_err(|error| format!("ps 输出不是 UTF-8: {error}"))?;
    Ok(parse_macos_process_list(&stdout))
}

#[cfg(target_os = "windows")]
fn collect_process_entries() -> Result<Vec<LocalProcessEntry>, String> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
        ])
        .output()
        .map_err(|error| format!("执行 PowerShell 失败: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "读取进程列表失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("PowerShell 输出不是 UTF-8: {error}"))?;

    if stdout.trim().is_empty() {
        return Ok(Vec::new());
    }

    let payload: WindowsProcessPayload =
        serde_json::from_str(&stdout).map_err(|error| format!("解析进程列表 JSON 失败: {error}"))?;
    let entries = match payload {
        WindowsProcessPayload::One(item) => vec![item],
        WindowsProcessPayload::Many(items) => items,
    };

    Ok(entries
        .into_iter()
        .filter_map(|item| {
            let command_line = item.command_line?.trim().to_string();

            if command_line.is_empty() {
                return None;
            }

            Some(LocalProcessEntry {
                pid: item.process_id,
                executable: item.executable_path,
                command_line,
            })
        })
        .collect())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn collect_process_entries() -> Result<Vec<LocalProcessEntry>, String> {
    Err("当前系统不支持本机 HOST 自动发现".to_string())
}

fn parse_macos_process_list(input: &str) -> Vec<LocalProcessEntry> {
    input
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();

            if trimmed.is_empty() {
                return None;
            }

            let mut parts = trimmed.split_whitespace();
            let pid = parts.next()?.parse::<u32>().ok()?;
            let executable = parts.next()?.to_string();
            let command_line = parts.collect::<Vec<_>>().join(" ");

            if command_line.is_empty() {
                return None;
            }

            Some(LocalProcessEntry {
                pid,
                executable: Some(executable),
                command_line,
            })
        })
        .collect()
}

fn parse_host_process(process: &LocalProcessEntry) -> Option<ParsedHostCommand> {
    let tokens = split_command_line(&process.command_line);

    if tokens.is_empty() {
        return None;
    }

    let source = detect_source(process.executable.as_deref(), &tokens)?;

    if !looks_like_codingns_start(&tokens) {
        return None;
    }

    let host = parse_flag_value(&tokens, "--host").unwrap_or_else(|| DEFAULT_HOST.to_string());
    let port = parse_flag_value(&tokens, "--port")
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let data_dir = parse_flag_value(&tokens, "--data-dir");
    let normalized_host = normalize_bind_host(&host);
    let base_url = format!("http://{}:{}", normalized_host, port);

    Some(ParsedHostCommand {
        source,
        base_url,
        port,
        data_dir,
    })
}

fn split_command_line(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
                continue;
            }

            if ch == '\\' {
                if let Some(next) = chars.peek().copied() {
                    if next == active_quote || next == '\\' {
                        let _ = chars.next();
                        current.push(next);
                        continue;
                    }
                }
            }

            current.push(ch);
            continue;
        }

        match ch {
            '"' | '\'' => {
                quote = Some(ch);
            }
            ' ' | '\t' | '\n' | '\r' => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn parse_flag_value(tokens: &[String], flag: &str) -> Option<String> {
    for (index, token) in tokens.iter().enumerate() {
        if token == flag {
            return tokens.get(index + 1).cloned();
        }

        let prefix = format!("{flag}=");

        if let Some(value) = token.strip_prefix(&prefix) {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}

fn looks_like_codingns_start(tokens: &[String]) -> bool {
    let has_start = tokens.iter().any(|token| token == "start");
    let has_codingns = tokens.iter().any(|token| is_codingns_token(token));

    has_start && has_codingns
}

fn detect_source(executable: Option<&str>, tokens: &[String]) -> Option<LocalHostProcessSource> {
    let executable_name = executable
        .and_then(|value| value.rsplit(['/', '\\']).next())
        .map(|value| value.to_ascii_lowercase());
    let first_token = tokens.first().map(|value| value.to_ascii_lowercase());

    let source_name = executable_name
        .clone()
        .or(first_token)
        .unwrap_or_default();

    if source_name.contains("codingns") {
        return Some(LocalHostProcessSource::Codingns);
    }

    if source_name == "npm" || source_name == "npm.cmd" || source_name == "npm.exe" {
        return Some(LocalHostProcessSource::Npm);
    }

    if source_name == "npx" || source_name == "npx.cmd" || source_name == "npx.exe" {
        return Some(LocalHostProcessSource::Npx);
    }

    if source_name == "node" || source_name == "node.exe" {
        return Some(LocalHostProcessSource::Node);
    }

    None
}

fn is_codingns_token(token: &str) -> bool {
    let normalized = token.to_ascii_lowercase();
    normalized.contains("codingns")
}

fn normalize_bind_host(input: &str) -> String {
    let normalized = input.trim().trim_matches('"').trim_matches('\'');

    if normalized.is_empty()
        || normalized == "0.0.0.0"
        || normalized == "::"
        || normalized == "[::]"
    {
        return DEFAULT_HOST.to_string();
    }

    normalized.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_bind_host, parse_flag_value, parse_host_process, parse_macos_process_list,
        split_command_line, LocalHostProcessSource, LocalProcessEntry,
    };

    #[test]
    fn split_command_line_keeps_quoted_segments() {
        let tokens = split_command_line(
            r#"node "/Users/demo/bin/codingns.mjs" start --data-dir "/tmp/demo host" --port 4100"#,
        );

        assert_eq!(
            tokens,
            vec![
                "node",
                "/Users/demo/bin/codingns.mjs",
                "start",
                "--data-dir",
                "/tmp/demo host",
                "--port",
                "4100"
            ]
        );
    }

    #[test]
    fn parse_flag_value_supports_inline_and_split_forms() {
        let split_tokens = vec![
            "codingns".to_string(),
            "start".to_string(),
            "--port".to_string(),
            "4100".to_string(),
        ];
        let inline_tokens = vec![
            "codingns".to_string(),
            "start".to_string(),
            "--host=0.0.0.0".to_string(),
        ];

        assert_eq!(parse_flag_value(&split_tokens, "--port").as_deref(), Some("4100"));
        assert_eq!(parse_flag_value(&inline_tokens, "--host").as_deref(), Some("0.0.0.0"));
    }

    #[test]
    fn parse_host_process_extracts_codingns_arguments() {
        let process = LocalProcessEntry {
            pid: 1234,
            executable: Some("/opt/homebrew/bin/node".to_string()),
            command_line:
                r#"node /opt/homebrew/lib/node_modules/@jingyi0605/codingns/dist/codingns.mjs start --host 0.0.0.0 --port 4100 --data-dir /tmp/codingns-demo"#
                    .to_string(),
        };

        let parsed = parse_host_process(&process).expect("应能识别 codingns 进程");

        assert!(matches!(parsed.source, LocalHostProcessSource::Node));
        assert_eq!(parsed.base_url, "http://127.0.0.1:4100");
        assert_eq!(parsed.port, 4100);
        assert_eq!(parsed.data_dir.as_deref(), Some("/tmp/codingns-demo"));
    }

    #[test]
    fn parse_host_process_rejects_unrelated_commands() {
        let process = LocalProcessEntry {
            pid: 4321,
            executable: Some("/usr/bin/python3".to_string()),
            command_line: "python3 server.py --port 4100".to_string(),
        };

        assert!(parse_host_process(&process).is_none());
    }

    #[test]
    fn normalize_bind_host_maps_wildcard_to_loopback() {
        assert_eq!(normalize_bind_host("0.0.0.0"), "127.0.0.1");
        assert_eq!(normalize_bind_host("::"), "127.0.0.1");
        assert_eq!(normalize_bind_host("localhost"), "localhost");
    }

    #[test]
    fn parse_macos_process_list_reads_pid_executable_and_command_line() {
        let processes = parse_macos_process_list(
            "1234 /opt/homebrew/bin/node node /opt/homebrew/bin/codingns.mjs start --port 3002\n",
        );

        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0].pid, 1234);
        assert_eq!(processes[0].executable.as_deref(), Some("/opt/homebrew/bin/node"));
        assert_eq!(
            processes[0].command_line,
            "node /opt/homebrew/bin/codingns.mjs start --port 3002"
        );
    }
}
