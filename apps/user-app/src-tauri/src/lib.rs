use std::io::Write;
use std::process::{Command, Stdio};

#[cfg(target_os = "ios")]
use std::ffi::CString;

#[cfg(target_os = "android")]
use std::mem::ManuallyDrop;

#[cfg(target_os = "android")]
use jni::{
  objects::{JObject, JValue},
  sys::jobject,
  JNIEnv
};

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
  copy_text_to_system_clipboard(&text)
}

#[tauri::command]
fn perform_haptic_feedback(kind: String) -> Result<(), String> {
  perform_platform_haptic_feedback(&kind)
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

fn perform_platform_haptic_feedback(_kind: &str) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    return perform_android_haptic_feedback(_kind);
  }

  #[cfg(target_os = "ios")]
  {
    return perform_ios_haptic_feedback(_kind);
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
unsafe extern "C" {
  fn codingns_perform_haptic_feedback(kind: *const std::os::raw::c_char);
}

#[cfg(target_os = "ios")]
fn perform_ios_haptic_feedback(kind: &str) -> Result<(), String> {
  let haptic_kind = CString::new(kind).map_err(|error| format!("iOS 触觉参数非法: {error}"))?;

  unsafe {
    codingns_perform_haptic_feedback(haptic_kind.as_ptr());
  }

  Ok(())
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
    .invoke_handler(tauri::generate_handler![copy_text, perform_haptic_feedback])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
