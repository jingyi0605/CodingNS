mod config;

use std::io::Write;
use std::process::{Command, Stdio};
#[cfg(target_os = "macos")]
use std::sync::mpsc;
#[cfg(target_os = "macos")]
use std::time::Duration;

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

#[cfg(target_os = "android")]
use std::mem::ManuallyDrop;

#[cfg(target_os = "android")]
use jni::{
  objects::{JObject, JValue},
  sys::jobject,
  JNIEnv
};

#[cfg(target_os = "ios")]
use objc2::{class, msg_send, runtime::AnyObject};

use config::DesktopRuntimeConfig;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeInfo {
  version: String,
  app_data_dir: Option<String>,
  window_chrome: Option<DesktopWindowChromeInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopWindowChromeInfo {
  macos_titlebar: Option<MacOsTitlebarMetrics>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MacOsTitlebarMetrics {
  overlay: bool,
  traffic_light_center_y: f64,
  traffic_light_leading_inset: f64,
  traffic_light_safe_zone_width: f64,
  traffic_light_button_diameter: f64,
  titlebar_height: f64,
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
  build_runtime_info(&app)
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
  copy_text_to_system_clipboard(&text)
}

#[tauri::command]
fn perform_haptic_feedback(app: AppHandle, kind: String) -> Result<(), String> {
  perform_platform_haptic_feedback(Some(&app), &kind)
}

#[tauri::command]
fn set_window_state(app: AppHandle, state: String) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "找不到主窗口".to_string())?;

  apply_window_state(&window, &state)
}

fn apply_window_state(window: &WebviewWindow, state: &str) -> Result<(), String> {
  // iOS / Android 没有桌面窗口管理语义，直接明确返回不支持，
  // 不要硬把桌面 API 编译到移动端。
  #[cfg(any(target_os = "ios", target_os = "android"))]
  {
    let _ = window;
    let _ = state;
    return Err("当前平台不支持窗口控制".to_string());
  }

  #[cfg(not(any(target_os = "ios", target_os = "android")))]
  {
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
    _ => Err(format!("不支持的窗口状态: {state}"))
  }
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
      ("xsel", vec!["--clipboard", "--input"])
    ];

    let mut last_error = None;

    for (command, args) in clipboard_commands {
      match run_clipboard_command(command, &args, text) {
        Ok(()) => return Ok(()),
        Err(error) => last_error = Some(error)
      }
    }

    return Err(last_error.unwrap_or_else(|| "当前系统没有可用的剪贴板命令".to_string()));
  }

  #[allow(unreachable_code)]
  Err("当前系统暂不支持复制到剪贴板".to_string())
}

fn build_runtime_info(app: &AppHandle) -> DesktopRuntimeInfo {
  DesktopRuntimeInfo {
    version: app.package_info().version.to_string(),
    app_data_dir: app
      .path()
      .app_data_dir()
      .ok()
      .map(|path| path.to_string_lossy().to_string()),
    window_chrome: collect_window_chrome_info(app)
  }
}

#[cfg(target_os = "macos")]
fn collect_window_chrome_info(app: &AppHandle) -> Option<DesktopWindowChromeInfo> {
  let window = app.get_webview_window("main")?;
  let main_thread_window = window.clone();
  let (sender, receiver) = mpsc::sync_channel(1);

  // AppKit 几何信息必须在主线程读取，否则得到的结果不稳定。
  if window
    .run_on_main_thread(move || {
      let metrics = unsafe { read_macos_titlebar_metrics(&main_thread_window) };
      let _ = sender.send(metrics);
    })
    .is_err()
  {
    return None;
  }

  receiver
    .recv_timeout(Duration::from_millis(500))
    .ok()
    .flatten()
    .map(|macos_titlebar| DesktopWindowChromeInfo {
      macos_titlebar: Some(macos_titlebar)
    })
}

#[cfg(not(target_os = "macos"))]
fn collect_window_chrome_info(_app: &AppHandle) -> Option<DesktopWindowChromeInfo> {
  None
}

#[cfg(target_os = "macos")]
unsafe fn read_macos_titlebar_metrics(window: &WebviewWindow) -> Option<MacOsTitlebarMetrics> {
  let ns_window_ptr = window.ns_window().ok()?;
  let ns_window: &NSWindow = &*ns_window_ptr.cast();
  let close = ns_window.standardWindowButton(NSWindowButton::CloseButton)?;
  let miniaturize = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)?;
  let trailing_rect = ns_window
    .standardWindowButton(NSWindowButton::ZoomButton)
    .map(|button| NSView::frame(&button))
    .unwrap_or_else(|| NSView::frame(&miniaturize));
  let close_rect = NSView::frame(&close);
  let title_bar_container_view = close.superview()?.superview()?;
  let title_bar_rect = NSView::frame(&title_bar_container_view);

  if close_rect.size.height <= 0.0 || title_bar_rect.size.height <= 0.0 {
    return None;
  }

  let button_center_y = close_rect.origin.y + (close_rect.size.height / 2.0);
  let trailing_edge = trailing_rect.origin.x + trailing_rect.size.width;

  Some(MacOsTitlebarMetrics {
    overlay: true,
    // 这里统一返回逻辑点，前端直接把它当 CSS 像素使用，不再自己猜 Retina 缩放。
    traffic_light_center_y: round_layout_value(button_center_y),
    traffic_light_leading_inset: round_layout_value(trailing_edge + 8.0),
    traffic_light_safe_zone_width: round_layout_value(trailing_edge + 16.0),
    traffic_light_button_diameter: round_layout_value(close_rect.size.height),
    titlebar_height: round_layout_value(title_bar_rect.size.height)
  })
}

fn round_layout_value(value: f64) -> f64 {
  (value * 100.0).round() / 100.0
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

fn perform_platform_haptic_feedback(app: Option<&AppHandle>, kind: &str) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    let _ = app;
    return perform_android_haptic_feedback(kind);
  }

  #[cfg(target_os = "ios")]
  {
    return perform_ios_haptic_feedback(app, kind);
  }

  #[allow(unreachable_code)]
  Ok(())
}

#[cfg(target_os = "android")]
fn perform_android_haptic_feedback(kind: &str) -> Result<(), String> {
  let android_context = ndk_context::android_context();
  let vm = unsafe { jni::JavaVM::from_raw(android_context.vm().cast()) }
    .map_err(|error| format!("读取 Android VM 失败: {error}"))?;
  let mut env = vm
    .attach_current_thread()
    .map_err(|error| format!("附着 Android 线程失败: {error}"))?;
  let activity = unsafe {
    ManuallyDrop::new(JObject::from_raw(android_context.context() as jobject))
  };
  let window = env
    .call_method(
      &*activity,
      "getWindow",
      "()Landroid/view/Window;",
      &[]
    )
    .and_then(|value| value.l())
    .map_err(|error| format!("获取 Android Window 失败: {error}"))?;
  let decor_view = env
    .call_method(window, "getDecorView", "()Landroid/view/View;", &[])
    .and_then(|value| value.l())
    .map_err(|error| format!("获取 Android DecorView 失败: {error}"))?;
  let feedback_constant = resolve_android_haptic_constant(&mut env, kind);

  let _ = env.call_method(
    decor_view,
    "performHapticFeedback",
    "(I)Z",
    &[JValue::Int(feedback_constant)]
  );

  Ok(())
}

#[cfg(target_os = "android")]
fn resolve_android_haptic_constant(env: &mut JNIEnv, kind: &str) -> i32 {
  let candidates = match kind {
    // 底部切换、分段切换这类“状态切换”优先用轻量 tick。
    "selection" => &["CLOCK_TICK", "KEYBOARD_TAP", "VIRTUAL_KEY"][..],
    // 主按钮点击给明确确认感，但别用过重反馈。
    "action" => &["KEYBOARD_TAP", "VIRTUAL_KEY", "CLOCK_TICK"][..],
    // 滑动开关、抽屉展开/收起用手势结束反馈更符合系统语义。
    "gesture" => &["GESTURE_END", "CLOCK_TICK", "KEYBOARD_TAP"][..],
    "success" => &["CONFIRM", "LONG_PRESS", "VIRTUAL_KEY"][..],
    "warning" => &["LONG_PRESS", "CLOCK_TICK", "KEYBOARD_TAP"][..],
    "error" => &["REJECT", "LONG_PRESS", "VIRTUAL_KEY"][..],
    _ => &["KEYBOARD_TAP", "VIRTUAL_KEY"][..]
  };

  for field_name in candidates {
    if let Some(value) = read_android_haptic_constant(env, field_name) {
      return value;
    }
  }

  3
}

#[cfg(target_os = "android")]
fn read_android_haptic_constant(env: &mut JNIEnv, field_name: &str) -> Option<i32> {
  let constants_class = env.find_class("android/view/HapticFeedbackConstants").ok()?;
  env
    .get_static_field(constants_class, field_name, "I")
    .ok()?
    .i()
    .ok()
}

#[cfg(target_os = "ios")]
fn perform_ios_haptic_feedback(app: Option<&AppHandle>, kind: &str) -> Result<(), String> {
  let Some(app) = app.cloned() else {
    return Err("缺少 iOS App 上下文，无法触发触觉反馈".to_string());
  };
  let resolved_kind = kind.to_string();

  app
    .run_on_main_thread(move || unsafe {
      trigger_ios_haptic_feedback(&resolved_kind);
    })
    .map_err(|error| format!("切换到 iOS 主线程失败: {error}"))
}

#[cfg(target_os = "ios")]
unsafe fn trigger_ios_haptic_feedback(kind: &str) {
  match kind {
    "selection" | "gesture" => {
      let generator: *mut AnyObject = msg_send![class!(UISelectionFeedbackGenerator), new];
      let (): () = msg_send![generator, prepare];
      let (): () = msg_send![generator, selectionChanged];
    }
    "success" | "warning" | "error" => {
      let generator: *mut AnyObject = msg_send![class!(UINotificationFeedbackGenerator), new];
      let notification_type: isize = match kind {
        "success" => 0,
        "warning" => 1,
        "error" => 2,
        _ => 0
      };
      let (): () = msg_send![generator, prepare];
      let (): () = msg_send![generator, notificationOccurred: notification_type];
    }
    _ => {
      let impact_style: isize = if kind == "action" { 1 } else { 0 };
      let generator: *mut AnyObject = msg_send![class!(UIImpactFeedbackGenerator), alloc];
      let generator: *mut AnyObject = msg_send![generator, initWithStyle: impact_style];
      let (): () = msg_send![generator, prepare];
      let (): () = msg_send![generator, impactOccurred];
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      read_desktop_config,
      write_desktop_config,
      get_runtime_info,
      copy_text,
      set_window_state,
      perform_haptic_feedback
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
