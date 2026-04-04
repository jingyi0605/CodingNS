mod config;
mod rollback;
mod updater;

use config::DesktopRuntimeConfig;
use rfd::FileDialog;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use updater::{DesktopReleaseState, DesktopRuntimeInfo, ReleaseManifest, UpdateInstallResult};

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
fn check_for_update(app: AppHandle, channel: String) -> Result<DesktopReleaseState, String> {
    updater::check_for_update(&app, &channel)
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
fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    // 统一走 Tauri 官方剪贴板能力，避免外部命令返回成功但系统剪贴板没真正更新。
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())
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

#[cfg(target_os = "macos")]
fn configure_macos_window_chrome(app: &tauri::App) -> tauri::Result<()> {
    use tauri::TitleBarStyle;

    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    // 统一顶栏要回到 Overlay 轨道，让应用工具栏真正进入标题栏区域。
    window.set_title_bar_style(TitleBarStyle::Overlay)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            configure_macos_window_chrome(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_desktop_config,
            write_desktop_config,
            get_runtime_info,
            check_for_update,
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
