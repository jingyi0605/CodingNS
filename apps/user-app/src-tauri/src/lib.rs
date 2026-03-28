use std::io::Write;
use std::process::{Command, Stdio};
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
#[repr(C)]
#[derive(Clone, Copy)]
struct NativeCGPoint {
  x: f64,
  y: f64,
}

#[cfg(target_os = "ios")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NativeCGSize {
  width: f64,
  height: f64,
}

#[cfg(target_os = "ios")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NativeCGRect {
  origin: NativeCGPoint,
  size: NativeCGSize,
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

#[cfg(target_os = "ios")]
unsafe fn expand_ios_webview_to_window(
  webview: *mut std::ffi::c_void,
  view_controller: *mut std::ffi::c_void,
) {
  const FULL_RESIZE_MASK: usize = 31;
  const CONTENT_INSET_ADJUSTMENT_NEVER: isize = 2;

  let webview = webview.cast::<AnyObject>();
  let view_controller = view_controller.cast::<AnyObject>();
  if webview.is_null() || view_controller.is_null() {
    return;
  }

  let controller_view: *mut AnyObject = msg_send![view_controller, view];
  if controller_view.is_null() {
    return;
  }

  let window: *mut AnyObject = msg_send![controller_view, window];
  let bounds: NativeCGRect = if window.is_null() {
    msg_send![controller_view, bounds]
  } else {
    msg_send![window, bounds]
  };

  let (): () = msg_send![controller_view, setFrame: bounds];
  let (): () = msg_send![webview, setFrame: bounds];
  let (): () = msg_send![webview, setAutoresizingMask: FULL_RESIZE_MASK];
  let (): () = msg_send![controller_view, setNeedsLayout];
  let (): () = msg_send![controller_view, layoutIfNeeded];

  let scroll_view: *mut AnyObject = msg_send![webview, scrollView];
  if !scroll_view.is_null() {
    let (): () = msg_send![
      scroll_view,
      setContentInsetAdjustmentBehavior: CONTENT_INSET_ADJUSTMENT_NEVER
    ];
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      #[cfg(target_os = "ios")]
      {
        // iOS 默认把 WebView 尺寸裁到 safe area，网页底栏永远贴不到屏幕最底部。
        // 这里直接把 WKWebView 拉到窗口全尺寸，让底部导航真正进入 home indicator 安全区。
        if let Some(webview) = app.get_webview("main") {
          webview
            .with_webview(|webview| unsafe {
              expand_ios_webview_to_window(webview.inner(), webview.view_controller());
            })
            .map_err(|error| format!("扩展 iOS WebView 失败: {error}"))?;
        }
      }

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
      copy_text,
      set_window_state,
      perform_haptic_feedback
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
