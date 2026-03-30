use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeConfig {
  pub platform: Option<String>,
  pub host_base_url: Option<String>,
  pub release_channel: Option<String>,
  pub auto_reconnect: Option<bool>,
  pub auto_check_update: Option<bool>,
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
  let config_dir = app
    .path()
    .app_config_dir()
    .map_err(|error| format!("无法解析桌面配置目录: {error}"))?;

  fs::create_dir_all(&config_dir)
    .map_err(|error| format!("无法创建桌面配置目录: {error}"))?;

  Ok(config_dir.join("client-runtime-config.json"))
}

fn read_desktop_config_from_path(path: &PathBuf) -> Result<DesktopRuntimeConfig, String> {
  if !path.exists() {
    return Ok(DesktopRuntimeConfig::default());
  }

  let raw = fs::read_to_string(path)
    .map_err(|error| format!("读取桌面配置失败: {error}"))?;

  serde_json::from_str::<DesktopRuntimeConfig>(&raw)
    .map_err(|error| format!("桌面配置格式无效: {error}"))
}

fn write_desktop_config_to_path(path: &PathBuf, patch: DesktopRuntimeConfig) -> Result<(), String> {
  let mut current = read_desktop_config_from_path(path).unwrap_or_default();

  if patch.platform.is_some() {
    current.platform = patch.platform;
  }
  if patch.host_base_url.is_some() {
    current.host_base_url = patch.host_base_url;
  }
  if patch.release_channel.is_some() {
    current.release_channel = patch.release_channel;
  }
  if patch.auto_reconnect.is_some() {
    current.auto_reconnect = patch.auto_reconnect;
  }
  if patch.auto_check_update.is_some() {
    current.auto_check_update = patch.auto_check_update;
  }
  let payload = serde_json::to_string_pretty(&current)
    .map_err(|error| format!("桌面配置序列化失败: {error}"))?;

  fs::write(path, payload)
    .map_err(|error| format!("写入桌面配置失败: {error}"))?;

  Ok(())
}

pub fn read_desktop_config(app: &AppHandle) -> Result<DesktopRuntimeConfig, String> {
  let path = config_file_path(app)?;
  read_desktop_config_from_path(&path)
}

pub fn write_desktop_config(app: &AppHandle, patch: DesktopRuntimeConfig) -> Result<(), String> {
  let path = config_file_path(app)?;
  write_desktop_config_to_path(&path, patch)
}

#[cfg(test)]
mod tests {
  use super::{read_desktop_config_from_path, write_desktop_config_to_path, DesktopRuntimeConfig};
  use std::fs;

  #[test]
  fn 后续写入会覆盖旧服务器地址并保持其他字段() {
    let temp_root = std::env::temp_dir().join(format!(
      "codingns-user-app-config-test-{}-{}",
      std::process::id(),
      std::thread::current().name().unwrap_or("main")
    ));
    let _ = fs::remove_dir_all(&temp_root);
    fs::create_dir_all(&temp_root).expect("创建临时目录失败");
    let config_path = temp_root.join("client-runtime-config.json");

    write_desktop_config_to_path(
      &config_path,
      DesktopRuntimeConfig {
        platform: Some("desktop".to_string()),
        host_base_url: Some("http://127.0.0.1:3002".to_string()),
        release_channel: Some("stable".to_string()),
        auto_reconnect: Some(true),
        auto_check_update: Some(true),
      },
    )
    .expect("第一次写入失败");

    write_desktop_config_to_path(
      &config_path,
      DesktopRuntimeConfig {
        platform: None,
        host_base_url: Some("http://10.10.1.9:4200".to_string()),
        release_channel: None,
        auto_reconnect: None,
        auto_check_update: None,
      },
    )
    .expect("第二次写入失败");

    let stored = read_desktop_config_from_path(&config_path).expect("读取配置失败");
    assert_eq!(stored.host_base_url.as_deref(), Some("http://10.10.1.9:4200"));
    assert_eq!(stored.platform.as_deref(), Some("desktop"));
    assert_eq!(stored.release_channel.as_deref(), Some("stable"));

    let _ = fs::remove_dir_all(&temp_root);
  }
}
