use std::io::Write;
use std::process::{Command, Stdio};

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
  copy_text_to_system_clipboard(&text)
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
    .invoke_handler(tauri::generate_handler![copy_text])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
