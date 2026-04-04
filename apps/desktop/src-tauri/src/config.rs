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

    fs::create_dir_all(&config_dir).map_err(|error| format!("无法创建桌面配置目录: {error}"))?;

    Ok(config_dir.join("client-runtime-config.json"))
}

pub fn read_desktop_config(app: &AppHandle) -> Result<DesktopRuntimeConfig, String> {
    let path = config_file_path(app)?;

    if !path.exists() {
        return Ok(DesktopRuntimeConfig::default());
    }

    let raw = fs::read_to_string(&path).map_err(|error| format!("读取桌面配置失败: {error}"))?;

    serde_json::from_str::<DesktopRuntimeConfig>(&raw)
        .map_err(|error| format!("桌面配置格式无效: {error}"))
}

pub fn write_desktop_config(app: &AppHandle, patch: DesktopRuntimeConfig) -> Result<(), String> {
    let path = config_file_path(app)?;
    let mut current = read_desktop_config(app).unwrap_or_default();

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

    fs::write(&path, payload).map_err(|error| format!("写入桌面配置失败: {error}"))?;

    Ok(())
}
