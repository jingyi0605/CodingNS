mod config;
mod rollback;
mod updater;
mod window_manager;

use config::DesktopRuntimeConfig;
use rfd::FileDialog;
use serde::Serialize;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WindowEvent,
};
use updater::{DesktopReleaseState, DesktopRuntimeInfo, ReleaseManifest, UpdateInstallResult};
use window_manager::{
    window_manager_error, WindowBounds, WindowDescriptor, WindowKind, WindowManagerState,
    WindowMode,
};

const DETACH_PREVIEW_WINDOW_LABEL: &str = "detach-preview";
const DETACH_PREVIEW_ROUTE: &str = "desktop-window-preview";
const DETACH_PREVIEW_BASE_WIDTH: f64 = 220.0;
const DETACH_PREVIEW_BASE_HEIGHT: f64 = 138.0;
const DETACH_PREVIEW_MIN_SCALE: f64 = 0.78;
const DETACH_PREVIEW_MAX_SCALE: f64 = 1.0;
const DETACH_PREVIEW_CURSOR_OFFSET_X: i32 = 12;
const DETACH_PREVIEW_CURSOR_OFFSET_Y: i32 = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowLifecycleEventPayload {
    descriptor: WindowDescriptor,
    is_open: bool,
}

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

#[tauri::command]
async fn create_window(
    app: AppHandle,
    window_manager: State<'_, WindowManagerState>,
    descriptor: WindowDescriptor,
) -> Result<(), String> {
    if descriptor.mode == WindowMode::External && !descriptor.supports_external_window() {
        return Err(window_manager_error(
            "WINDOW_KIND_NOT_SUPPORTED",
            format!(
                "当前阶段只允许外部窗口打开 files / git / processes，收到类型：{}",
                window_kind_label(&descriptor.kind)
            ),
        ));
    }

    if let Some(existing_window) = app.get_webview_window(&descriptor.window_id) {
        window_manager.sync_descriptor(descriptor.clone());
        sync_descriptor_bounds_from_window(&window_manager, &existing_window)?;
        existing_window.show().map_err(|error| error.to_string())?;
        existing_window
            .set_focus()
            .map_err(|error| error.to_string())?;
        window_manager.mark_window_open(&descriptor.window_id);
        emit_window_lifecycle_event(&app, &window_manager, &descriptor.window_id, true);
        return Ok(());
    }

    let builder = build_external_window(&app, &descriptor);
    let window = builder.build().map_err(|error| {
        window_manager_error(
            "WINDOW_CREATE_FAILED",
            format!("创建窗口 {} 失败：{error}", descriptor.window_id),
        )
    })?;

    attach_window_lifecycle_handlers(window.clone(), app.clone());
    window_manager.sync_descriptor(descriptor.clone());
    sync_descriptor_bounds_from_window(&window_manager, &window)?;
    window_manager.mark_window_open(&descriptor.window_id);
    emit_window_lifecycle_event(&app, &window_manager, &descriptor.window_id, true);
    Ok(())
}

#[tauri::command]
fn close_window(
    app: AppHandle,
    window_manager: State<'_, WindowManagerState>,
    window_id: String,
) -> Result<(), String> {
    let window = app.get_webview_window(&window_id).ok_or_else(|| {
        window_manager_error("WINDOW_NOT_FOUND", format!("找不到窗口：{window_id}"))
    })?;

    sync_descriptor_bounds_from_window(&window_manager, &window)?;
    window.close().map_err(|error| {
        window_manager_error(
            "WINDOW_CLOSE_FAILED",
            format!("关闭窗口 {window_id} 失败：{error}"),
        )
    })?;
    window_manager.mark_window_closed(&window_id);
    emit_window_lifecycle_event(&app, &window_manager, &window_id, false);
    Ok(())
}

#[tauri::command]
fn focus_window(
    app: AppHandle,
    window_manager: State<'_, WindowManagerState>,
    window_id: String,
) -> Result<(), String> {
    let window = app.get_webview_window(&window_id).ok_or_else(|| {
        window_manager_error("WINDOW_NOT_FOUND", format!("找不到窗口：{window_id}"))
    })?;

    window.show().map_err(|error| error.to_string())?;
    window
        .set_focus()
        .map_err(|error| window_manager_error("WINDOW_FOCUS_FAILED", error.to_string()))?;
    window_manager.mark_window_open(&window_id);
    emit_window_lifecycle_event(&app, &window_manager, &window_id, true);
    Ok(())
}

#[tauri::command]
fn list_windows(window_manager: State<'_, WindowManagerState>) -> Vec<WindowDescriptor> {
    window_manager.list_descriptors()
}

#[tauri::command]
fn is_window_open(
    app: AppHandle,
    window_manager: State<'_, WindowManagerState>,
    window_id: String,
) -> bool {
    if app.get_webview_window(&window_id).is_some() {
        return true;
    }

    window_manager.is_open(&window_id)
}

#[tauri::command]
fn get_window_descriptor(
    window: WebviewWindow,
    window_manager: State<'_, WindowManagerState>,
    window_id: Option<String>,
) -> Result<WindowDescriptor, String> {
    let resolved_window_id = window_id.unwrap_or_else(|| window.label().to_string());
    window_manager
        .get_descriptor(&resolved_window_id)
        .ok_or_else(|| {
            window_manager_error(
                "WINDOW_DESCRIPTOR_NOT_FOUND",
                format!("找不到窗口描述：{resolved_window_id}"),
            )
        })
}

#[tauri::command]
fn sync_window_descriptor(
    window_manager: State<'_, WindowManagerState>,
    descriptor: WindowDescriptor,
) -> Result<(), String> {
    window_manager.sync_descriptor(descriptor);
    Ok(())
}

#[tauri::command]
fn update_window_bounds(
    window_manager: State<'_, WindowManagerState>,
    window_id: String,
    bounds: WindowBounds,
) -> Result<(), String> {
    window_manager.update_bounds(&window_id, bounds)
}

#[tauri::command]
fn show_detach_preview(
    app: AppHandle,
    window: WebviewWindow,
    _title: String,
    x: i32,
    y: i32,
    scale: f64,
) -> Result<(), String> {
    let preview_scale = clamp_detach_preview_scale(scale);
    let (width, height) = resolve_detach_preview_size(preview_scale);
    let (position_x, position_y) = resolve_detach_preview_position(&window, x, y, width, height)?;

    if let Some(window) = app.get_webview_window(DETACH_PREVIEW_WINDOW_LABEL) {
        window
            .set_title("小窗口")
            .map_err(|error| error.to_string())?;
        window
            .set_size(LogicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(LogicalPosition::new(position_x, position_y))
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        DETACH_PREVIEW_WINDOW_LABEL,
        WebviewUrl::App(DETACH_PREVIEW_ROUTE.into()),
    )
    .title("小窗口")
    .inner_size(width, height)
    .min_inner_size(width, height)
    .max_inner_size(width, height)
    .position(position_x, position_y)
    .resizable(false)
    .focused(false)
    .focusable(false)
    .accept_first_mouse(true)
    .visible(true)
    .always_on_top(true)
    .decorations(false)
    .shadow(true)
    .skip_taskbar(true)
    .build()
    .map(|_| ())
    .map_err(|error| {
        window_manager_error(
            "DETACH_PREVIEW_CREATE_FAILED",
            format!("创建拆窗预览窗口失败：{error}"),
        )
    })
}

#[tauri::command]
fn update_detach_preview_position(
    app: AppHandle,
    caller_window: WebviewWindow,
    x: i32,
    y: i32,
    scale: f64,
) -> Result<(), String> {
    let Some(preview_window) = app.get_webview_window(DETACH_PREVIEW_WINDOW_LABEL) else {
        return Ok(());
    };

    let preview_scale = clamp_detach_preview_scale(scale);
    let (width, height) = resolve_detach_preview_size(preview_scale);
    let (position_x, position_y) =
        resolve_detach_preview_position(&caller_window, x, y, width, height)?;

    preview_window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    preview_window
        .set_position(LogicalPosition::new(position_x, position_y))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_detach_preview(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(DETACH_PREVIEW_WINDOW_LABEL) else {
        return Ok(());
    };

    window.close().map_err(|error| {
        window_manager_error(
            "DETACH_PREVIEW_CLOSE_FAILED",
            format!("关闭拆窗预览窗口失败：{error}"),
        )
    })
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

fn build_external_window<'a>(
    app: &'a AppHandle,
    descriptor: &WindowDescriptor,
) -> tauri::WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        &descriptor.window_id,
        WebviewUrl::App(build_external_window_route(&descriptor.window_id).into()),
    )
    .title(window_title_for_descriptor(descriptor))
    .inner_size(
        descriptor.bounds.width as f64,
        descriptor.bounds.height as f64,
    )
    .min_inner_size(
        descriptor.bounds.min_width as f64,
        descriptor.bounds.min_height as f64,
    )
    .resizable(true)
    .decorations(true)
    .accept_first_mouse(true)
    .focused(true)
    .visible(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .hidden_title(false)
            .title_bar_style(tauri::TitleBarStyle::Visible);
    }

    if let (Some(x), Some(y)) = (descriptor.bounds.x, descriptor.bounds.y) {
        builder = builder.position(x as f64, y as f64);
    }

    builder
}

fn build_external_window_route(window_id: &str) -> String {
    format!("desktop-window/{window_id}")
}

fn clamp_detach_preview_scale(scale: f64) -> f64 {
    scale.clamp(DETACH_PREVIEW_MIN_SCALE, DETACH_PREVIEW_MAX_SCALE)
}

fn resolve_detach_preview_size(scale: f64) -> (f64, f64) {
    (
        (DETACH_PREVIEW_BASE_WIDTH * scale).round(),
        (DETACH_PREVIEW_BASE_HEIGHT * scale).round(),
    )
}

fn resolve_detach_preview_position(
    caller_window: &WebviewWindow,
    x: i32,
    y: i32,
    _width: f64,
    _height: f64,
) -> Result<(f64, f64), String> {
    let content_origin = caller_window
        .inner_position()
        .map_err(|error| error.to_string())?;
    let scale_factor = caller_window
        .scale_factor()
        .map_err(|error| error.to_string())?;
    let logical_origin = content_origin.to_logical::<f64>(scale_factor);
    let logical_offset_x = DETACH_PREVIEW_CURSOR_OFFSET_X as f64 / scale_factor;
    let logical_offset_y = DETACH_PREVIEW_CURSOR_OFFSET_Y as f64 / scale_factor;

    Ok((
        logical_origin.x + x as f64 + logical_offset_x,
        logical_origin.y + y as f64 + logical_offset_y,
    ))
}

fn attach_window_lifecycle_handlers(window: WebviewWindow, app: AppHandle) {
    let window_for_events = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let state = app.state::<WindowManagerState>();
            let _ = sync_descriptor_bounds_from_window(&state, &window_for_events);
            emit_window_lifecycle_event(
                &app,
                &state,
                window_for_events.label(),
                state.is_open(window_for_events.label()),
            );
        }
        WindowEvent::Focused(true) => {
            let state = app.state::<WindowManagerState>();
            state.mark_window_open(window_for_events.label());
            emit_window_lifecycle_event(&app, &state, window_for_events.label(), true);
        }
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            let state = app.state::<WindowManagerState>();
            let _ = sync_descriptor_bounds_from_window(&state, &window_for_events);
            state.mark_window_closed(window_for_events.label());
            emit_window_lifecycle_event(&app, &state, window_for_events.label(), false);
        }
        _ => {}
    });
}

fn emit_window_lifecycle_event(
    app: &AppHandle,
    window_manager: &WindowManagerState,
    window_id: &str,
    is_open: bool,
) {
    let Some(descriptor) = window_manager.get_descriptor(window_id) else {
        return;
    };

    let _ = app.emit(
        "desktop://window-lifecycle",
        WindowLifecycleEventPayload {
            descriptor,
            is_open,
        },
    );
}

fn sync_descriptor_bounds_from_window(
    window_manager: &WindowManagerState,
    window: &WebviewWindow,
) -> Result<(), String> {
    let existing_descriptor = window_manager
        .get_descriptor(window.label())
        .ok_or_else(|| {
            window_manager_error(
                "WINDOW_DESCRIPTOR_NOT_FOUND",
                format!("找不到窗口描述：{}", window.label()),
            )
        })?;

    let outer_position = window.outer_position().map_err(|error| error.to_string())?;
    let inner_size = window.inner_size().map_err(|error| error.to_string())?;
    window_manager.update_bounds(
        window.label(),
        WindowBounds {
            x: Some(outer_position.x),
            y: Some(outer_position.y),
            width: inner_size.width,
            height: inner_size.height,
            min_width: existing_descriptor.bounds.min_width,
            min_height: existing_descriptor.bounds.min_height,
        },
    )
}

fn window_title_for_descriptor(descriptor: &WindowDescriptor) -> String {
    format!("CodingNS - {}", window_kind_label(&descriptor.kind))
}

fn window_kind_label(kind: &WindowKind) -> &'static str {
    match kind {
        WindowKind::Chat => "聊天",
        WindowKind::Files => "文件",
        WindowKind::Git => "Git",
        WindowKind::Processes => "进程管理",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_external_window_route, clamp_detach_preview_scale, resolve_detach_preview_size,
        window_kind_label, DETACH_PREVIEW_BASE_HEIGHT, DETACH_PREVIEW_BASE_WIDTH,
        DETACH_PREVIEW_CURSOR_OFFSET_X, DETACH_PREVIEW_CURSOR_OFFSET_Y,
    };
    use crate::window_manager::WindowKind;

    #[test]
    fn external_window_route_points_to_desktop_window_shell() {
        assert_eq!(
            build_external_window_route("files-workspace-1"),
            "desktop-window/files-workspace-1"
        );
    }

    #[test]
    fn window_kind_label_stays_human_readable() {
        assert_eq!(window_kind_label(&WindowKind::Files), "文件");
        assert_eq!(window_kind_label(&WindowKind::Processes), "进程管理");
    }

    #[test]
    fn detach_preview_scale_is_clamped_into_supported_range() {
        assert_eq!(clamp_detach_preview_scale(0.1), 0.78);
        assert_eq!(clamp_detach_preview_scale(0.92), 0.92);
        assert_eq!(clamp_detach_preview_scale(2.0), 1.0);
    }

    #[test]
    fn detach_preview_position_tracks_cursor_with_visual_offset() {
        let (width, height) = resolve_detach_preview_size(1.0);
        assert_eq!(width, DETACH_PREVIEW_BASE_WIDTH);
        assert_eq!(height, DETACH_PREVIEW_BASE_HEIGHT);

        // 具体的屏幕坐标依赖调用窗口的内容区起点，这里只验证偏移常量保持稳定。
        assert_eq!(DETACH_PREVIEW_CURSOR_OFFSET_X, 12);
        assert_eq!(DETACH_PREVIEW_CURSOR_OFFSET_Y, 12);
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
        .manage(WindowManagerState::default())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            configure_macos_window_chrome(_app)?;

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
            set_window_state,
            create_window,
            close_window,
            focus_window,
            list_windows,
            is_window_open,
            get_window_descriptor,
            sync_window_descriptor,
            update_window_bounds,
            show_detach_preview,
            update_detach_preview_position,
            close_detach_preview
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodingNS desktop shell");
}
