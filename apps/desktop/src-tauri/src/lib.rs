mod config;
mod host_discovery;
mod rollback;
mod updater;
mod window_manager;

use config::DesktopRuntimeConfig;
use host_discovery::DesktopLocalHostProcessHit;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WindowEvent,
};
#[cfg(target_os = "macos")]
use {
    objc2::MainThreadMarker,
    objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameVibrantDark,
        NSAppearanceNameVibrantLight, NSAutoresizingMaskOptions, NSColor, NSView,
        NSViewLayerContentsRedrawPolicy,
        NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState,
        NSVisualEffectView, NSWindow, NSWindowOrderingMode,
    },
    objc2_foundation::{NSPoint, NSRect, NSSize},
    std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    },
};
use updater::{DesktopReleaseState, DesktopRuntimeInfo, UpdateInstallResult};
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
#[cfg(target_os = "macos")]
const MACOS_NATIVE_SIDEBAR_MIN_VISIBLE_WIDTH: f64 = 1.0;

#[cfg(target_os = "macos")]
const MACOS_NATIVE_RIGHT_SIDEBAR_OVERSCAN_WIDTH: f64 = 240.0;

#[cfg(target_os = "macos")]
const MACOS_NATIVE_LEFT_SIDEBAR_AUTOREZING_MASK: NSAutoresizingMaskOptions =
    NSAutoresizingMaskOptions::ViewMaxXMargin.union(NSAutoresizingMaskOptions::ViewHeightSizable);

#[cfg(target_os = "macos")]
const MACOS_NATIVE_RIGHT_SIDEBAR_AUTOREZING_MASK: NSAutoresizingMaskOptions =
    NSAutoresizingMaskOptions::ViewMinXMargin.union(NSAutoresizingMaskOptions::ViewHeightSizable);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowLifecycleEventPayload {
    descriptor: WindowDescriptor,
    is_open: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSidebarLayoutPayload {
    left_width: f64,
    right_width: f64,
    left_collapsed: bool,
    right_collapsed: bool,
    prefers_dark_appearance: bool,
    is_resizing: bool,
}

#[derive(Debug, Clone, Default)]
struct MacosNativeSidebarState {
    #[cfg(target_os = "macos")]
    windows: Arc<Mutex<HashMap<String, MacosNativeSidebarWindowState>>>,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Default)]
struct MacosNativeSidebarWindowState {
    layout: MacosNativeSidebarLayoutState,
    left_view_ptr: Option<usize>,
    right_view_ptr: Option<usize>,
    rendered_left_width: f64,
    rendered_right_width: f64,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone)]
struct MacosNativeSidebarLayoutState {
    left_width: f64,
    right_width: f64,
    left_collapsed: bool,
    right_collapsed: bool,
    prefers_dark_appearance: bool,
    is_resizing: bool,
}

#[cfg(target_os = "macos")]
impl Default for MacosNativeSidebarLayoutState {
    fn default() -> Self {
        Self {
            left_width: 0.0,
            right_width: 0.0,
            left_collapsed: true,
            right_collapsed: true,
            prefers_dark_appearance: false,
            is_resizing: false,
        }
    }
}

#[cfg(target_os = "macos")]
impl From<&NativeSidebarLayoutPayload> for MacosNativeSidebarLayoutState {
    fn from(value: &NativeSidebarLayoutPayload) -> Self {
        Self {
            left_width: sanitize_native_sidebar_width(value.left_width),
            right_width: sanitize_native_sidebar_width(value.right_width),
            left_collapsed: value.left_collapsed,
            right_collapsed: value.right_collapsed,
            prefers_dark_appearance: value.prefers_dark_appearance,
            is_resizing: value.is_resizing,
        }
    }
}

#[cfg(target_os = "macos")]
impl MacosNativeSidebarState {
    fn upsert_layout(
        &self,
        window_label: &str,
        payload: &NativeSidebarLayoutPayload,
    ) -> MacosNativeSidebarWindowState {
        let mut guard = self.windows.lock().expect("macOS 原生侧栏状态锁被污染");
        let entry = guard.entry(window_label.to_string()).or_default();
        let next_layout = MacosNativeSidebarLayoutState::from(payload);

        entry.rendered_left_width = resolve_macos_native_sidebar_rendered_width(
            entry.rendered_left_width,
            next_layout.left_width,
            next_layout.left_collapsed,
            next_layout.is_resizing,
        );
        entry.rendered_right_width = resolve_macos_native_sidebar_rendered_width(
            entry.rendered_right_width,
            next_layout.right_width,
            next_layout.right_collapsed,
            next_layout.is_resizing,
        );
        entry.layout = next_layout;
        entry.clone()
    }

    fn get_window_state(&self, window_label: &str) -> Option<MacosNativeSidebarWindowState> {
        let guard = self.windows.lock().expect("macOS 原生侧栏状态锁被污染");
        guard.get(window_label).cloned()
    }

    fn update_view_pointers(
        &self,
        window_label: &str,
        left_view_ptr: Option<usize>,
        right_view_ptr: Option<usize>,
    ) {
        let mut guard = self.windows.lock().expect("macOS 原生侧栏状态锁被污染");
        let entry = guard.entry(window_label.to_string()).or_default();
        entry.left_view_ptr = left_view_ptr;
        entry.right_view_ptr = right_view_ptr;
    }
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
fn scan_local_hosts() -> Result<Vec<DesktopLocalHostProcessHit>, String> {
    host_discovery::scan_local_hosts()
}

#[tauri::command]
fn get_runtime_info(app: AppHandle) -> DesktopRuntimeInfo {
    updater::get_runtime_info(&app)
}

#[tauri::command]
async fn check_for_update(app: AppHandle, channel: String) -> Result<DesktopReleaseState, String> {
    updater::check_for_update(&app, &channel).await
}

#[tauri::command]
async fn install_update(app: AppHandle, channel: String) -> UpdateInstallResult {
    updater::install_update(&app, &channel).await
}

#[tauri::command]
fn restart_application(app: AppHandle) -> Result<(), String> {
    app.request_restart();
    Ok(())
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
fn set_window_state(window: WebviewWindow, state: String) -> Result<(), String> {
    apply_window_state(&window, &state)
}

#[tauri::command]
fn sync_native_sidebar_layout(
    window: WebviewWindow,
    native_sidebar_state: State<'_, MacosNativeSidebarState>,
    layout: NativeSidebarLayoutPayload,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        let _ = native_sidebar_state;
        let _ = layout;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let window_label = window.label().to_string();
        let native_sidebar_state = native_sidebar_state.inner().clone();
        let sidebar_state = native_sidebar_state.upsert_layout(&window_label, &layout);
        schedule_macos_native_sidebar_layout(
            &window,
            window_label,
            native_sidebar_state,
            sidebar_state,
        )
    }
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
                "当前阶段只允许外部窗口打开 files / git / processes / terminals，收到类型：{}",
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

#[cfg(target_os = "macos")]
fn sanitize_native_sidebar_width(width: f64) -> f64 {
    if width.is_finite() && width > 0.0 {
        width
    } else {
        0.0
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_native_sidebar_rendered_width(
    previous_rendered_width: f64,
    requested_width: f64,
    collapsed: bool,
    is_resizing: bool,
) -> f64 {
    if collapsed {
        return 0.0;
    }

    if is_resizing {
        previous_rendered_width.max(requested_width)
    } else {
        requested_width
    }
}

#[cfg(target_os = "macos")]
unsafe fn apply_macos_native_sidebar_layout(
    window: &WebviewWindow,
    window_label: &str,
    native_sidebar_state: &MacosNativeSidebarState,
    sidebar_state: &MacosNativeSidebarWindowState,
) {
    let Ok(ns_window_ptr) = window.ns_window() else {
        return;
    };
    let ns_window: &NSWindow = unsafe { &*ns_window_ptr.cast() };
    let Some(content_view) = ns_window.contentView() else {
        return;
    };
    let content_frame = content_view.frame();
    let content_width = content_frame.size.width.max(0.0);
    let content_height = content_frame.size.height.max(0.0);
    let sidebar_appearance = resolve_macos_native_sidebar_appearance(
        sidebar_state.layout.prefers_dark_appearance,
    );

    let mut left_view_ptr = ensure_macos_native_sidebar_view(
        &content_view,
        sidebar_state.left_view_ptr,
        sidebar_appearance.as_deref(),
    );
    let mut right_view_ptr = ensure_macos_native_sidebar_view(
        &content_view,
        sidebar_state.right_view_ptr,
        sidebar_appearance.as_deref(),
    );

    let left_visible = !sidebar_state.layout.left_collapsed
        && sidebar_state.rendered_left_width > MACOS_NATIVE_SIDEBAR_MIN_VISIBLE_WIDTH;
    let right_visible = !sidebar_state.layout.right_collapsed
        && sidebar_state.rendered_right_width > MACOS_NATIVE_SIDEBAR_MIN_VISIBLE_WIDTH;
    let left_width = sidebar_state.rendered_left_width.min(content_width).max(0.0);
    let right_width = sidebar_state.rendered_right_width.min(content_width).max(0.0);
    // 右侧栏在整窗 live resize 收窄时，AppKit 偶尔会先把 trailing edge 裁进去，
    // 再把 NSVisualEffectView 的 x 位置补上，导致左侧瞬间漏底。
    // 这里给右栏材质层向左多铺一段缓冲区，藏在中间不透明内容层下面，避免露出桌面。
    let right_effect_width = if right_visible {
        (right_width + MACOS_NATIVE_RIGHT_SIDEBAR_OVERSCAN_WIDTH)
            .min(content_width)
            .max(0.0)
    } else {
        0.0
    };
    let right_origin_x = (content_width - right_effect_width).max(0.0);

    apply_macos_native_sidebar_frame(
        left_view_ptr,
        NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(left_width, content_height)),
        left_visible,
        MACOS_NATIVE_LEFT_SIDEBAR_AUTOREZING_MASK,
    );
    apply_macos_native_sidebar_frame(
        right_view_ptr,
        NSRect::new(
            NSPoint::new(right_origin_x, 0.0),
            NSSize::new(right_effect_width, content_height),
        ),
        right_visible,
        MACOS_NATIVE_RIGHT_SIDEBAR_AUTOREZING_MASK,
    );

    // 某些情况下内容视图会重建，重新取到的新 subview 需要把指针写回状态。
    if left_view_ptr.is_none() {
        left_view_ptr = ensure_macos_native_sidebar_view(
            &content_view,
            None,
            sidebar_appearance.as_deref(),
        );
    }
    if right_view_ptr.is_none() {
        right_view_ptr = ensure_macos_native_sidebar_view(
            &content_view,
            None,
            sidebar_appearance.as_deref(),
        );
    }

    native_sidebar_state.update_view_pointers(window_label, left_view_ptr, right_view_ptr);
}

#[cfg(target_os = "macos")]
unsafe fn configure_macos_live_resize_view(view: &NSView) {
    view.setPostsFrameChangedNotifications(true);
    view.setLayerContentsRedrawPolicy(NSViewLayerContentsRedrawPolicy::DuringViewResize);
    view.setNeedsDisplay(true);
}

#[cfg(target_os = "macos")]
fn configure_macos_window_live_resize(window: &WebviewWindow) -> Result<(), String> {
    let window_for_resize = window.clone();

    window
        .run_on_main_thread(move || unsafe {
            let Ok(ns_window_ptr) = window_for_resize.ns_window() else {
                return;
            };
            let Ok(ns_view_ptr) = window_for_resize.ns_view() else {
                return;
            };
            let ns_window: &NSWindow = &*ns_window_ptr.cast();
            let content_view: &NSView = &*ns_view_ptr.cast();

            // zoom / live resize 期间先保留上一帧内容，不要把新区域直接露成透明底。
            ns_window.setPreservesContentDuringLiveResize(true);
            configure_macos_live_resize_view(content_view);

            let _ = window_for_resize.with_webview(|webview| {
                let webview_view: &NSView = &*webview.inner().cast();
                configure_macos_live_resize_view(webview_view);
            });
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn sync_macos_webview_frame(window: &WebviewWindow) -> Result<(), String> {
    let window_for_resize = window.clone();

    window
        .run_on_main_thread(move || unsafe {
            let Ok(ns_view_ptr) = window_for_resize.ns_view() else {
                return;
            };
            let content_view: &NSView = &*ns_view_ptr.cast();
            let content_bounds = content_view.bounds();

            let _ = window_for_resize.with_webview(move |webview| {
                let webview_view: &NSView = &*webview.inner().cast();
                webview_view.setFrame(content_bounds);
                webview_view.setNeedsDisplay(true);
                webview_view.displayIfNeeded();
            });
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn schedule_macos_native_sidebar_layout(
    window: &WebviewWindow,
    window_label: String,
    native_sidebar_state: MacosNativeSidebarState,
    sidebar_state: MacosNativeSidebarWindowState,
) -> Result<(), String> {
    let sync_window = window.clone();

    window
        .run_on_main_thread(move || unsafe {
            apply_macos_native_sidebar_layout(
                &sync_window,
                &window_label,
                &native_sidebar_state,
                &sidebar_state,
            );
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn sync_cached_macos_native_sidebar_layout(
    window: &WebviewWindow,
    native_sidebar_state: &MacosNativeSidebarState,
) -> Result<(), String> {
    let window_label = window.label().to_string();
    let Some(sidebar_state) = native_sidebar_state.get_window_state(&window_label) else {
        return Ok(());
    };

    schedule_macos_native_sidebar_layout(
        window,
        window_label,
        native_sidebar_state.clone(),
        sidebar_state,
    )
}

#[cfg(target_os = "macos")]
unsafe fn ensure_macos_native_sidebar_view(
    content_view: &NSView,
    existing_ptr: Option<usize>,
    appearance: Option<&NSAppearance>,
) -> Option<usize> {
    if let Some(ptr) = existing_ptr {
        let view = &*(ptr as *const NSVisualEffectView);
        view.setAppearance(appearance);

        if let Some(superview) = view.superview() {
          if std::ptr::eq(&*superview, content_view) {
              return Some(ptr);
          }
        }

        view.removeFromSuperviewWithoutNeedingDisplay();
    }

    let mtm = MainThreadMarker::new().expect("创建 macOS 原生侧栏必须在主线程执行");
    let effect_view = NSVisualEffectView::initWithFrame(
        mtm.alloc(),
        NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0)),
    );
    effect_view.setMaterial(NSVisualEffectMaterial::Sidebar);
    // 侧边栏属于窗口内部语义，不该像贴在桌面上的整窗毛玻璃。
    effect_view.setBlendingMode(NSVisualEffectBlendingMode::WithinWindow);
    effect_view.setState(NSVisualEffectState::FollowsWindowActiveState);
    effect_view.setAppearance(appearance);
    effect_view.setAutoresizingMask(MACOS_NATIVE_LEFT_SIDEBAR_AUTOREZING_MASK);
    effect_view.setLayerContentsRedrawPolicy(NSViewLayerContentsRedrawPolicy::DuringViewResize);
    effect_view.setHidden(true);
    content_view.addSubview_positioned_relativeTo(&effect_view, NSWindowOrderingMode::Below, None);
    Some((&*effect_view) as *const NSVisualEffectView as usize)
}

#[cfg(target_os = "macos")]
fn resolve_macos_native_sidebar_appearance(prefers_dark_appearance: bool) -> Option<objc2::rc::Retained<NSAppearance>> {
    let appearance_name = unsafe {
        if prefers_dark_appearance {
            NSAppearanceNameVibrantDark
        } else {
            NSAppearanceNameVibrantLight
        }
    };

    NSAppearance::appearanceNamed(appearance_name)
}

#[cfg(target_os = "macos")]
unsafe fn apply_macos_native_sidebar_frame(
    view_ptr: Option<usize>,
    frame: NSRect,
    visible: bool,
    autoresizing_mask: NSAutoresizingMaskOptions,
) {
    let Some(view_ptr) = view_ptr else {
        return;
    };
    let view = unsafe { &*(view_ptr as *const NSVisualEffectView) };
    view.setAutoresizingMask(autoresizing_mask);
    view.setFrame(frame);
    view.setNeedsDisplay(true);
    view.setHidden(!visible);
}

fn apply_window_state(window: &WebviewWindow, state: &str) -> Result<(), String> {
    match state {
        "minimize" => window.minimize().map_err(|error| error.to_string()),
        "maximize" => window.maximize().map_err(|error| error.to_string()),
        "toggle-maximize" => toggle_window_maximize(window),
        "toggle-zoom" => toggle_window_zoom(window),
        "close" => window.close().map_err(|error| error.to_string()),
        _ => Err(format!("不支持的窗口状态: {state}")),
    }
}

fn toggle_window_maximize(window: &WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

fn toggle_window_zoom(window: &WebviewWindow) -> Result<(), String> {
    toggle_window_maximize(window)
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

#[cfg(target_os = "macos")]
fn attach_macos_native_sidebar_handlers(window: WebviewWindow, native_sidebar_state: MacosNativeSidebarState) {
    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Resized(_)) {
            let _ = sync_cached_macos_native_sidebar_layout(&window_for_events, &native_sidebar_state);
            let _ = sync_macos_webview_frame(&window_for_events);
        }
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
    let section_title = window_kind_label(&descriptor.kind);

    match descriptor.workspace_name.as_deref() {
        Some(workspace_name) if !workspace_name.trim().is_empty() => {
            format!("CodingNS - {}（{}）", section_title, workspace_name.trim())
        }
        _ => format!("CodingNS - {}", section_title),
    }
}

fn window_kind_label(kind: &WindowKind) -> &'static str {
    match kind {
        WindowKind::Chat => "聊天",
        WindowKind::Files => "文件",
        WindowKind::Git => "Git",
        WindowKind::Processes => "进程管理",
        WindowKind::Terminals => "终端",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_external_window_route, clamp_detach_preview_scale, resolve_detach_preview_size,
        window_kind_label, window_title_for_descriptor, DETACH_PREVIEW_BASE_HEIGHT,
        DETACH_PREVIEW_BASE_WIDTH, DETACH_PREVIEW_CURSOR_OFFSET_X,
        DETACH_PREVIEW_CURSOR_OFFSET_Y,
    };
    use crate::window_manager::{WindowBounds, WindowDescriptor, WindowKind, WindowMode};

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
        assert_eq!(window_kind_label(&WindowKind::Terminals), "终端");
    }

    #[test]
    fn window_title_prefers_workspace_name_when_present() {
        let descriptor = WindowDescriptor {
            window_id: "terminals-workspace-1".to_string(),
            kind: WindowKind::Terminals,
            workspace_id: Some("workspace-1".to_string()),
            workspace_name: Some("项目一".to_string()),
            session_id: None,
            mode: WindowMode::External,
            bounds: WindowBounds {
                x: None,
                y: None,
                width: 1200,
                height: 780,
                min_width: 720,
                min_height: 480,
            },
            focus_owner: Some("terminal-page".to_string()),
        };

        assert_eq!(window_title_for_descriptor(&descriptor), "CodingNS - 终端（项目一）");
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

    window.set_title_bar_style(TitleBarStyle::Overlay)?;
    let native_window = window.clone();
    window.run_on_main_thread(move || unsafe {
        let Ok(ns_window_ptr) = native_window.ns_window() else {
            return;
        };
        let ns_window: &NSWindow = &*ns_window_ptr.cast();
        let clear_color = NSColor::clearColor();

        // 原生侧栏毛玻璃依赖透明窗口通道；0.4.0 在这里把窗口改回不透明实底，
        // 等于直接把左右侧栏的材质能力关掉了。
        // live resize 期间的补帧仍然由 configure_macos_window_live_resize 负责，
        // 不需要靠 setOpaque(true) 把整窗打回实色。
        ns_window.setBackgroundColor(Some(&clear_color));
        ns_window.setOpaque(false);
    })?;
    configure_macos_window_live_resize(&window).map_err(std::io::Error::other)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // 预览窗是临时态，记住它只会把下一次拖拽预览搞乱。
                .with_denylist(&[DETACH_PREVIEW_WINDOW_LABEL])
                .build(),
        )
        .manage(WindowManagerState::default())
        .manage(MacosNativeSidebarState::default());

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                configure_macos_window_chrome(app)?;

                if let Some(window) = app.get_webview_window("main") {
                    let native_sidebar_state = app.state::<MacosNativeSidebarState>().inner().clone();
                    attach_macos_native_sidebar_handlers(window, native_sidebar_state);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_desktop_config,
            write_desktop_config,
            scan_local_hosts,
            get_runtime_info,
            check_for_update,
            install_update,
            restart_application,
            rollback_to_previous_version,
            open_external,
            show_notification,
            copy_text,
            pick_directory,
            set_window_state,
            sync_native_sidebar_layout,
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
