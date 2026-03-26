mod config;
mod rollback;
mod updater;

use config::DesktopRuntimeConfig;
use rfd::FileDialog;
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager, WebviewWindow};
use updater::{DesktopRuntimeInfo, ReleaseManifest, UpdateInstallResult};

#[tauri::command]
fn read_desktop_config(app: AppHandle) -> Result<DesktopRuntimeConfig, String> {
    config::read_desktop_config(&app)
}

#[tauri::command]
fn write_desktop_config(app: AppHandle, patch: DesktopRuntimeConfig) -> Result<(), String> {
    config::write_desktop_config(&app, patch)
}

#[tauri::command]
fn get_runtime_info(app: AppHandle) -> DesktopRuntimeInfo {
    updater::get_runtime_info(&app)
}

#[tauri::command]
fn install_update(app: AppHandle, manifest: ReleaseManifest) -> UpdateInstallResult {
    updater::install_update(&app, manifest)
}

#[tauri::command]
fn rollback_to_previous_version(app: AppHandle) -> Result<(), String> {
    rollback::rollback_to_previous_version(&app)
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    updater::open_external(&url)
}

#[tauri::command]
fn show_notification(title: String, body: String) -> Result<(), String> {
    println!("[desktop-notification] {title}: {body}");
    Ok(())
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    copy_text_to_system_clipboard(&text)
}

#[tauri::command]
fn pick_directory() -> Option<String> {
    FileDialog::new()
        .pick_folder()
        .map(|path| path.display().to_string())
}

#[tauri::command]
fn set_window_state(app: AppHandle, state: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;

    apply_window_state(&window, &state)
}

fn apply_window_state(window: &WebviewWindow, state: &str) -> Result<(), String> {
    match state {
        "minimize" => window.minimize().map_err(|error| error.to_string()),
        "maximize" => window.maximize().map_err(|error| error.to_string()),
        "toggle-maximize" => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize().map_err(|error| error.to_string())
            } else {
                window.maximize().map_err(|error| error.to_string())
            }
        }
        "close" => window.close().map_err(|error| error.to_string()),
        _ => Err(format!("不支持的窗口状态: {state}")),
    }
}

fn copy_text_to_system_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return run_clipboard_command("pbcopy", &[], text);
    }

    #[cfg(target_os = "windows")]
    {
        return run_clipboard_command("cmd", &["/C", "clip"], text);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let clipboard_commands = [
            ("wl-copy", Vec::<&str>::new()),
            ("xclip", vec!["-selection", "clipboard"]),
            ("xsel", vec!["--clipboard", "--input"]),
        ];

        let mut last_error = None;

        for (command, args) in clipboard_commands {
            match run_clipboard_command(command, &args, text) {
                Ok(()) => return Ok(()),
                Err(error) => last_error = Some(error),
            }
        }

        return Err(last_error.unwrap_or_else(|| "当前系统没有可用的剪贴板命令".to_string()));
    }

    #[allow(unreachable_code)]
    Err("当前系统暂不支持复制到剪贴板".to_string())
}

fn run_clipboard_command(command: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动剪贴板命令失败: {command}: {error}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|error| format!("写入剪贴板命令失败: {command}: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("等待剪贴板命令失败: {command}: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("剪贴板命令执行失败: {command}")
    } else {
        format!("剪贴板命令执行失败: {command}: {stderr}")
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_desktop_config,
            write_desktop_config,
            get_runtime_info,
            install_update,
            rollback_to_previous_version,
            open_external,
            show_notification,
            copy_text,
            pick_directory,
            set_window_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodingNS desktop shell");
}
