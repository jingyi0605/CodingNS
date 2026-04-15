use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackState {
    pub previous_version: String,
    pub package_path: String,
    pub created_at: String,
}

fn rollback_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法解析桌面数据目录: {error}"))?;

    fs::create_dir_all(&data_dir).map_err(|error| format!("无法创建桌面数据目录: {error}"))?;

    Ok(data_dir.join("desktop-update-rollback.json"))
}

#[allow(dead_code)]
pub fn save_rollback_state(
    app: &AppHandle,
    previous_version: &str,
    package_path: &Path,
) -> Result<(), String> {
    let path = rollback_state_path(app)?;
    let state = RollbackState {
        previous_version: previous_version.to_string(),
        package_path: package_path.to_string_lossy().to_string(),
        created_at: Utc::now().to_rfc3339(),
    };

    let payload = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("回退状态序列化失败: {error}"))?;

    fs::write(path, payload).map_err(|error| format!("写入回退状态失败: {error}"))?;

    Ok(())
}

fn load_rollback_state(app: &AppHandle) -> Result<RollbackState, String> {
    let path = rollback_state_path(app)?;

    if !path.exists() {
        return Err("当前没有可回退的桌面版本".to_string());
    }

    let raw = fs::read_to_string(path).map_err(|error| format!("读取回退状态失败: {error}"))?;

    serde_json::from_str::<RollbackState>(&raw)
        .map_err(|error| format!("回退状态格式无效: {error}"))
}

pub fn rollback_to_previous_version(app: &AppHandle) -> Result<(), String> {
    let state = load_rollback_state(app)?;
    let package_path = PathBuf::from(&state.package_path);

    if !package_path.exists() {
        return Err(format!("回退安装包不存在: {}", package_path.display()));
    }

    open_installer(&package_path)
}

pub fn open_installer(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn()
            .map_err(|error| format!("启动安装包失败: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("启动安装包失败: {error}"))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("启动安装包失败: {error}"))?;
    }

    Ok(())
}
