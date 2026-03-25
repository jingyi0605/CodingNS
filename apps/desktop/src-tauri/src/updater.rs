use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::{Path, PathBuf}, process::Command};
use tauri::{AppHandle, Manager};

use crate::rollback;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManifest {
    pub channel: String,
    pub platform: String,
    pub version: String,
    pub notes: String,
    pub package_url: String,
    pub signature: String,
    pub published_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfo {
    pub version: String,
    pub app_data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResult {
    pub ok: bool,
    pub error_code: Option<String>,
    pub detail: Option<String>,
    pub downloaded_file_path: Option<String>,
}

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法解析桌面数据目录: {error}"))?;
    let updates_dir = data_dir.join("updates");
    fs::create_dir_all(&updates_dir)
        .map_err(|error| format!("无法创建更新目录: {error}"))?;
    Ok(updates_dir)
}

fn file_name_from_manifest(manifest: &ReleaseManifest) -> String {
    let extension = if manifest.package_url.ends_with(".msi") {
        "msi"
    } else if manifest.package_url.ends_with(".dmg") {
        "dmg"
    } else if manifest.package_url.ends_with(".pkg") {
        "pkg"
    } else {
        "bin"
    };

    format!("codingns-desktop-{}.{}", manifest.version, extension)
}

fn normalize_signature(signature: &str) -> String {
    signature
        .trim()
        .strip_prefix("sha256:")
        .unwrap_or(signature.trim())
        .to_lowercase()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("无法读取更新包: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|error| format!("无法读取更新包内容: {error}"))?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn download_package(app: &AppHandle, manifest: &ReleaseManifest) -> Result<PathBuf, String> {
    let target_path = updates_dir(app)?.join(file_name_from_manifest(manifest));
    let client = Client::new();
    let mut response = client
        .get(&manifest.package_url)
        .send()
        .map_err(|error| format!("下载更新包失败: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("下载更新包失败，HTTP 状态码 {}", response.status()));
    }

    let mut bytes = Vec::new();
    response
        .copy_to(&mut bytes)
        .map_err(|error| format!("读取更新包响应失败: {error}"))?;

    fs::write(&target_path, bytes)
        .map_err(|error| format!("写入更新包失败: {error}"))?;

    Ok(target_path)
}

fn verify_signature(manifest: &ReleaseManifest, package_path: &Path) -> Result<(), String> {
    let expected = normalize_signature(&manifest.signature);
    let actual = sha256_file(package_path)?;

    if expected != actual {
        return Err("更新包签名校验失败".to_string());
    }

    Ok(())
}

fn open_release_package(path: &Path) -> Result<(), String> {
    rollback::open_installer(path)
}

pub fn get_runtime_info(app: &AppHandle) -> DesktopRuntimeInfo {
    DesktopRuntimeInfo {
        version: app.package_info().version.to_string(),
        app_data_dir: app
            .path()
            .app_data_dir()
            .ok()
            .map(|path| path.to_string_lossy().to_string()),
    }
}

pub fn install_update(app: &AppHandle, manifest: ReleaseManifest) -> UpdateInstallResult {
    let current_version = app.package_info().version.to_string();

    match download_package(app, &manifest)
        .and_then(|package_path| {
            verify_signature(&manifest, &package_path)?;
            rollback::save_rollback_state(app, &current_version, &package_path)?;
            open_release_package(&package_path)?;
            Ok(package_path)
        }) {
        Ok(package_path) => UpdateInstallResult {
            ok: true,
            error_code: None,
            detail: None,
            downloaded_file_path: Some(package_path.to_string_lossy().to_string()),
        },
        Err(detail) => UpdateInstallResult {
            ok: false,
            error_code: Some("UPDATE_ERROR".to_string()),
            detail: Some(detail),
            downloaded_file_path: None,
        },
    }
}

pub fn open_external(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|error| format!("打开外部链接失败: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|error| format!("打开外部链接失败: {error}"))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|error| format!("打开外部链接失败: {error}"))?;
    }

    Ok(())
}
