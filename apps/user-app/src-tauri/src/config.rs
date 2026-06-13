use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeConfig {
  pub platform: Option<String>,
  pub host_base_url: Option<String>,
  pub active_host_id: Option<String>,
  // HOST 配置由前端定义。桌面桥只负责保存 JSON，不应该裁剪 alias、peerEnabled 这类字段。
  pub hosts: Option<Vec<Value>>,
  pub release_channel: Option<String>,
  pub auto_reconnect: Option<bool>,
  pub auto_check_update: Option<bool>,
  #[serde(flatten)]
  pub extra: Map<String, Value>,
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
  let config_dir = app
    .path()
    .app_config_dir()
    .map_err(|error| format!("无法解析桌面配置目录: {error}"))?;

  fs::create_dir_all(&config_dir).map_err(|error| format!("无法创建桌面配置目录: {error}"))?;

  Ok(config_dir.join("client-runtime-config.json"))
}

fn read_desktop_config_from_path(path: &PathBuf) -> Result<DesktopRuntimeConfig, String> {
  if !path.exists() {
    return Ok(DesktopRuntimeConfig::default());
  }

  let raw = fs::read_to_string(path).map_err(|error| format!("读取桌面配置失败: {error}"))?;

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
  if patch.active_host_id.is_some() {
    current.active_host_id = patch.active_host_id;
    current.host_base_url = None;
  }
  if patch.hosts.is_some() {
    current.hosts = patch.hosts;
    current.host_base_url = None;
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
  for (key, value) in patch.extra {
    current.extra.insert(key, value);
  }
  let payload = serde_json::to_string_pretty(&current)
    .map_err(|error| format!("桌面配置序列化失败: {error}"))?;

  fs::write(path, payload).map_err(|error| format!("写入桌面配置失败: {error}"))?;

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
  use super::{
    read_desktop_config_from_path, write_desktop_config_to_path, DesktopRuntimeConfig,
  };
  use serde_json::{json, Map, Value};
  use std::fs;

  #[test]
  fn 后续写入会写入新_host_结构并保持其他字段() {
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
        active_host_id: None,
        hosts: None,
        release_channel: Some("stable".to_string()),
        auto_reconnect: Some(true),
        auto_check_update: Some(true),
        extra: Map::new(),
      },
    )
    .expect("第一次写入失败");

    write_desktop_config_to_path(
      &config_path,
      DesktopRuntimeConfig {
        platform: None,
        host_base_url: None,
        active_host_id: Some("host-2".to_string()),
        hosts: Some(vec![
          json!({
            "id": "host-1",
            "name": "127.0.0.1:3002",
            "alias": "MAC",
            "baseUrl": "http://127.0.0.1:3002",
            "kind": "local",
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T00:00:00.000Z",
            "lastConnectedAt": null,
            "lastUserId": null,
            "lastUsername": null,
            "peerEnabled": false,
            "peerHostId": null
          }),
          json!({
            "id": "host-2",
            "name": "10.10.1.9:4200",
            "alias": "WIN",
            "baseUrl": "http://10.10.1.9:4200",
            "kind": "lan",
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T00:00:00.000Z",
            "lastConnectedAt": null,
            "lastUserId": null,
            "lastUsername": null,
            "peerEnabled": true,
            "peerHostId": "peer-2"
          }),
        ]),
        release_channel: None,
        auto_reconnect: None,
        auto_check_update: None,
        extra: Map::new(),
      },
    )
    .expect("第二次写入失败");

    let stored = read_desktop_config_from_path(&config_path).expect("读取配置失败");
    assert_eq!(stored.host_base_url, None);
    assert_eq!(stored.active_host_id.as_deref(), Some("host-2"));
    assert_eq!(stored.hosts.as_ref().map(|hosts| hosts.len()), Some(2));
    assert_eq!(stored.hosts.as_ref().unwrap()[0]["alias"], json!("MAC"));
    assert_eq!(stored.hosts.as_ref().unwrap()[1]["peerEnabled"], json!(true));
    assert_eq!(stored.hosts.as_ref().unwrap()[1]["peerHostId"], json!("peer-2"));
    assert_eq!(stored.platform.as_deref(), Some("desktop"));
    assert_eq!(stored.release_channel.as_deref(), Some("stable"));

    let _ = fs::remove_dir_all(&temp_root);
  }

  #[test]
  fn 能兼容读取只包含旧_host_base_url_字段的配置() {
    let temp_root = std::env::temp_dir().join(format!(
      "codingns-user-app-config-legacy-read-{}-{}",
      std::process::id(),
      std::thread::current().name().unwrap_or("main")
    ));
    let _ = fs::remove_dir_all(&temp_root);
    fs::create_dir_all(&temp_root).expect("创建临时目录失败");
    let config_path = temp_root.join("client-runtime-config.json");

    fs::write(
      &config_path,
      r#"{
  "platform": "desktop",
  "hostBaseUrl": "http://10.10.1.8:4100",
  "releaseChannel": "beta"
}"#,
    )
    .expect("写入旧配置失败");

    let stored = read_desktop_config_from_path(&config_path).expect("读取配置失败");
    assert_eq!(stored.host_base_url.as_deref(), Some("http://10.10.1.8:4100"));
    assert_eq!(stored.active_host_id, None);
    assert!(stored.hosts.is_none());
    assert_eq!(stored.release_channel.as_deref(), Some("beta"));

    let _ = fs::remove_dir_all(&temp_root);
  }

  #[test]
  fn 桌面配置会保留前端新增的顶层字段() {
    let temp_root = std::env::temp_dir().join(format!(
      "codingns-user-app-config-extra-field-{}-{}",
      std::process::id(),
      std::thread::current().name().unwrap_or("main")
    ));
    let _ = fs::remove_dir_all(&temp_root);
    fs::create_dir_all(&temp_root).expect("创建临时目录失败");
    let config_path = temp_root.join("client-runtime-config.json");

    let mut extra = Map::new();
    extra.insert("language".to_string(), json!("zh-CN"));
    extra.insert("defaultPermissionMode".to_string(), json!("acceptEdits"));
    extra.insert("betaChannelConsentAcceptedAt".to_string(), Value::Null);

    write_desktop_config_to_path(
      &config_path,
      DesktopRuntimeConfig {
        platform: Some("desktop".to_string()),
        host_base_url: None,
        active_host_id: None,
        hosts: None,
        release_channel: None,
        auto_reconnect: None,
        auto_check_update: None,
        extra,
      },
    )
    .expect("写入配置失败");

    let raw = fs::read_to_string(&config_path).expect("读取配置失败");
    let stored: Value = serde_json::from_str(&raw).expect("解析配置失败");
    assert_eq!(stored["language"], json!("zh-CN"));
    assert_eq!(stored["defaultPermissionMode"], json!("acceptEdits"));
    assert!(stored["betaChannelConsentAcceptedAt"].is_null());

    let _ = fs::remove_dir_all(&temp_root);
  }
}
