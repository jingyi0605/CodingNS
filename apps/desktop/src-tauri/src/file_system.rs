use serde::Serialize;
use std::{
    path::PathBuf,
    process::Command,
};
#[cfg(target_os = "linux")]
use std::path::Path;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::HWND,
    UI::{
        Shell::ShellExecuteW,
        WindowsAndMessaging::SW_SHOWNORMAL,
    },
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub platform: String,
    pub is_desktop: bool,
    pub file_manager: String,
}

pub fn open_local_file(path: String) -> Result<(), String> {
    let path = validate_local_path(&path)?;

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.arg(&path);
        return run_command(
            command,
            "OPEN_FAILED",
            format!("系统打开文件失败：{}", path.display()),
        );
    }

    #[cfg(target_os = "windows")]
    {
        return open_local_file_windows(&path);
    }

    #[cfg(target_os = "linux")]
    {
        let mut command = Command::new("xdg-open");
        command.arg(&path);
        return run_command(
            command,
            "OPEN_FAILED",
            format!("系统打开文件失败：{}", path.display()),
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = path;
        Err(desktop_file_error(
            "PLATFORM_NOT_SUPPORTED",
            "当前平台暂不支持打开本地文件。",
        ))
    }
}

pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let path = validate_local_path(&path)?;

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.args(["-R"]).arg(&path);
        return run_command(
            command,
            "REVEAL_FAILED",
            format!("在 Finder 中定位文件失败：{}", path.display()),
        );
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        if path.is_dir() {
            command.arg(&path);
        } else {
            command.arg(format!("/select,{}", path.display()));
        }
        return run_command(
            command,
            "REVEAL_FAILED",
            format!("在资源管理器中定位文件失败：{}", path.display()),
        );
    }

    #[cfg(target_os = "linux")]
    {
        let reveal_target = if path.is_dir() {
            path.clone()
        } else {
            path.parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| path.clone())
        };

        let mut command = Command::new("xdg-open");
        command.arg(&reveal_target);
        return run_command(
            command,
            "REVEAL_FAILED",
            format!(
                "在文件管理器中打开目标位置失败：{}",
                reveal_target.display()
            ),
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = path;
        Err(desktop_file_error(
            "PLATFORM_NOT_SUPPORTED",
            "当前平台暂不支持在文件管理器中显示目标文件。",
        ))
    }
}

pub fn get_platform_info() -> PlatformInfo {
    #[cfg(target_os = "macos")]
    {
        return PlatformInfo {
            platform: "macos".to_string(),
            is_desktop: true,
            file_manager: "finder".to_string(),
        };
    }

    #[cfg(target_os = "windows")]
    {
        return PlatformInfo {
            platform: "windows".to_string(),
            is_desktop: true,
            file_manager: "explorer".to_string(),
        };
    }

    #[cfg(target_os = "linux")]
    {
        return PlatformInfo {
            platform: "linux".to_string(),
            is_desktop: true,
            file_manager: "file-manager".to_string(),
        };
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        PlatformInfo {
            platform: "unknown".to_string(),
            is_desktop: true,
            file_manager: "unknown".to_string(),
        }
    }
}

fn validate_local_path(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed_path = raw_path.trim();

    if trimmed_path.is_empty() {
        return Err(desktop_file_error("INVALID_PATH", "路径不能为空。"));
    }

    if is_probably_url_or_scheme(trimmed_path) {
        return Err(desktop_file_error(
            "PATH_IS_URL",
            format!("不接受 URL 或 scheme 路径：{trimmed_path}"),
        ));
    }

    let path = PathBuf::from(trimmed_path);

    if !path.is_absolute() {
        return Err(desktop_file_error(
            "PATH_NOT_ABSOLUTE",
            format!("只接受绝对路径：{trimmed_path}"),
        ));
    }

    if !path.exists() {
        return Err(desktop_file_error(
            missing_target_error_code(trimmed_path),
            format!("目标路径不存在：{trimmed_path}"),
        ));
    }

    Ok(path)
}

fn is_probably_url_or_scheme(value: &str) -> bool {
    if value.contains("://") {
        return true;
    }

    let Some(separator_index) = value.find(':') else {
        return false;
    };

    if separator_index == 1 {
        let mut chars = value.chars();
        let Some(drive_letter) = chars.next() else {
            return false;
        };
        let Some(after_colon) = chars.nth(1) else {
            return false;
        };

        if drive_letter.is_ascii_alphabetic() && matches!(after_colon, '\\' | '/') {
            return false;
        }
    }

    let scheme = &value[..separator_index];
    !scheme.is_empty()
        && scheme
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || matches!(char, '+' | '-' | '.'))
}

fn missing_target_error_code(raw_path: &str) -> &'static str {
    if raw_path.ends_with('/') || raw_path.ends_with('\\') {
        "DIRECTORY_NOT_FOUND"
    } else {
        "FILE_NOT_FOUND"
    }
}

fn run_command(mut command: Command, error_code: &str, failure_detail: String) -> Result<(), String> {
    let status = command
        .status()
        .map_err(|error| desktop_file_error(error_code, format!("{failure_detail}：{error}")))?;

    if status.success() {
        return Ok(());
    }

    let exit_code = status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    Err(desktop_file_error(
        error_code,
        format!("{failure_detail}，退出码：{exit_code}"),
    ))
}

fn desktop_file_error(code: &str, detail: impl Into<String>) -> String {
    format!("{code}: {}", detail.into())
}

#[cfg(target_os = "windows")]
fn open_local_file_windows(path: &PathBuf) -> Result<(), String> {
    let operation = to_wide_null("open");
    let file = to_wide_path(path);
    let result = unsafe {
        ShellExecuteW(
            0 as HWND,
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;

    if result > 32 {
        return Ok(());
    }

    Err(desktop_file_error(
        "OPEN_FAILED",
        format!(
            "系统打开文件失败：{}，ShellExecuteW 返回码：{result}",
            path.display()
        ),
    ))
}

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn to_wide_path(path: &PathBuf) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{get_platform_info, is_probably_url_or_scheme, open_local_file, reveal_in_file_manager};
    use std::{
        env,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_path(file_name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间异常")
            .as_millis();
        env::temp_dir()
            .join(format!("codingns-desktop-file-smoke-{millis}"))
            .join(file_name)
    }

    #[test]
    fn rejects_empty_path() {
        let result = open_local_file("   ".to_string());
        assert_eq!(result, Err("INVALID_PATH: 路径不能为空。".to_string()));
    }

    #[test]
    fn rejects_relative_path() {
        let result = open_local_file("notes/test.txt".to_string());
        assert_eq!(
            result,
            Err("PATH_NOT_ABSOLUTE: 只接受绝对路径：notes/test.txt".to_string())
        );
    }

    #[test]
    fn rejects_url_path() {
        let result = open_local_file("https://example.com/demo.pdf".to_string());
        assert_eq!(
            result,
            Err("PATH_IS_URL: 不接受 URL 或 scheme 路径：https://example.com/demo.pdf".to_string())
        );
    }

    #[test]
    fn rejects_missing_target() {
        let path = unique_temp_path("missing.txt");
        let result = reveal_in_file_manager(path.display().to_string());
        assert_eq!(
            result,
            Err(format!("FILE_NOT_FOUND: 目标路径不存在：{}", path.display()))
        );
    }

    #[test]
    fn scheme_detection_keeps_windows_drive_letter() {
        assert!(is_probably_url_or_scheme("file:/tmp/demo.pdf"));
        assert!(is_probably_url_or_scheme("custom-scheme:demo"));
        assert!(!is_probably_url_or_scheme("C:\\Users\\jackson\\demo.pdf"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_shell_execute_path_encoding_keeps_spaces_and_chinese() {
        let path = PathBuf::from(r#"X:\售前文档\G-歌尔声学\中文 空格 文件.docx"#);
        let encoded = super::to_wide_path(&path);
        assert_eq!(encoded.last().copied(), Some(0));
        let restored = String::from_utf16_lossy(&encoded[..encoded.len() - 1]);
        assert_eq!(restored, path.display().to_string());
    }

    #[test]
    fn platform_info_matches_current_target() {
        let info = get_platform_info();
        assert!(info.is_desktop);

        #[cfg(target_os = "macos")]
        {
            assert_eq!(info.platform, "macos");
            assert_eq!(info.file_manager, "finder");
        }

        #[cfg(target_os = "windows")]
        {
            assert_eq!(info.platform, "windows");
            assert_eq!(info.file_manager, "explorer");
        }

        #[cfg(target_os = "linux")]
        {
            assert_eq!(info.platform, "linux");
            assert_eq!(info.file_manager, "file-manager");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "会真实唤起 macOS 默认应用，仅用于本机手工验收"]
    fn macos_open_local_file_smoke_supports_chinese_and_spaces() {
        let file_path = unique_temp_path("中文 空格 文件.txt");
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("创建 smoke 目录失败");
        }
        fs::write(&file_path, "codingns smoke").expect("写入 smoke 文件失败");

        let result = open_local_file(file_path.display().to_string());
        assert!(result.is_ok(), "打开本地文件失败：{result:?}");
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "会真实唤起 Finder，仅用于本机手工验收"]
    fn macos_reveal_in_finder_smoke_supports_chinese_and_spaces() {
        let file_path = unique_temp_path("中文 空格 Finder 文件.txt");
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("创建 smoke 目录失败");
        }
        fs::write(&file_path, "codingns smoke").expect("写入 smoke 文件失败");

        let result = reveal_in_file_manager(file_path.display().to_string());
        assert!(result.is_ok(), "Finder 定位失败：{result:?}");
    }
}
