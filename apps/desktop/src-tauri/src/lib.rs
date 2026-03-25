mod config;
mod rollback;
mod updater;

use config::DesktopRuntimeConfig;
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
            set_window_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodingNS desktop shell");
}
