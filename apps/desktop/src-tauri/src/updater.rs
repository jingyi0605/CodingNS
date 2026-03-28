use chrono::Utc;
use reqwest::{
    blocking::Client,
    header::{ACCEPT, USER_AGENT},
};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

use crate::rollback;

const GITHUB_RELEASES_OWNER: &str = "placeholder-owner";
const GITHUB_RELEASES_REPO: &str = "placeholder-repo";
const GITHUB_API_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_USER_AGENT: &str = "CodingNS-Desktop-Updater";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManifest {
    pub channel: String,
    pub platform: String,
    pub version: String,
    pub tag_name: String,
    pub title: String,
    pub notes: String,
    pub package_url: Option<String>,
    pub signature: Option<String>,
    pub html_url: String,
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
pub struct DesktopReleaseState {
    pub checked_at: String,
    pub current_version: String,
    pub has_update: bool,
    pub manifest: Option<ReleaseManifest>,
    pub runtime_info: DesktopRuntimeInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResult {
    pub ok: bool,
    pub error_code: Option<String>,
    pub detail: Option<String>,
    pub downloaded_file_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
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
    let package_url = manifest.package_url.as_deref().unwrap_or_default();
    let extension = if package_url.ends_with(".msi") {
        "msi"
    } else if package_url.ends_with(".dmg") {
        "dmg"
    } else if package_url.ends_with(".pkg") {
        "pkg"
    } else if package_url.ends_with(".deb") {
        "deb"
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
    let package_url = manifest
        .package_url
        .as_deref()
        .ok_or_else(|| "当前 release 还没有可用的安装包地址".to_string())?;
    let target_path = updates_dir(app)?.join(file_name_from_manifest(manifest));
    let client = Client::new();
    let mut response = client
        .get(package_url)
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
    let Some(signature) = manifest.signature.as_deref() else {
        return Err("当前 release 还没有提供安装校验信息".to_string());
    };
    let expected = normalize_signature(signature);
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

pub fn check_for_update(app: &AppHandle, channel: &str) -> Result<DesktopReleaseState, String> {
    let runtime_info = get_runtime_info(app);
    let current_version = runtime_info.version.clone();
    let platform = resolve_release_platform().to_string();
    let manifest = fetch_release_manifest(channel, &platform)?;
    let has_update = manifest
        .as_ref()
        .map(|release| is_newer_version(&current_version, &release.version))
        .unwrap_or(false);

    Ok(DesktopReleaseState {
        checked_at: Utc::now().to_rfc3339(),
        current_version,
        has_update,
        manifest,
        runtime_info,
    })
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

fn github_releases_api_url() -> String {
    format!(
        "https://api.github.com/repos/{}/{}/releases?per_page=10",
        GITHUB_RELEASES_OWNER, GITHUB_RELEASES_REPO
    )
}

fn github_release_fallback_url(tag_name: &str) -> String {
    format!(
        "https://github.com/{}/{}/releases/tag/{}",
        GITHUB_RELEASES_OWNER, GITHUB_RELEASES_REPO, tag_name
    )
}

fn create_github_client() -> Result<Client, String> {
    Client::builder()
        .build()
        .map_err(|error| format!("创建 GitHub 更新检查客户端失败: {error}"))
}

fn fetch_release_manifest(channel: &str, platform: &str) -> Result<Option<ReleaseManifest>, String> {
    let client = create_github_client()?;
    let response = client
        .get(github_releases_api_url())
        .header(ACCEPT, GITHUB_API_ACCEPT)
        .header(USER_AGENT, GITHUB_USER_AGENT)
        .send()
        .map_err(|error| format!("请求 GitHub Release 失败: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "请求 GitHub Release 失败，HTTP 状态码 {}",
            response.status()
        ));
    }

    let raw = response
        .text()
        .map_err(|error| format!("读取 GitHub Release 响应失败: {error}"))?;
    let releases = serde_json::from_str::<Vec<GitHubRelease>>(&raw)
        .map_err(|error| format!("解析 GitHub Release 响应失败: {error}"))?;

    let Some(release) = select_release(&releases, channel) else {
        return Ok(None);
    };

    Ok(Some(build_release_manifest(&client, channel, platform, release)))
}

fn select_release<'a>(releases: &'a [GitHubRelease], channel: &str) -> Option<&'a GitHubRelease> {
    if channel.eq_ignore_ascii_case("beta") {
        return releases
            .iter()
            .find(|release| !release.draft && release.prerelease)
            .or_else(|| releases.iter().find(|release| !release.draft));
    }

    releases
        .iter()
        .find(|release| !release.draft && !release.prerelease)
}

fn build_release_manifest(client: &Client, channel: &str, platform: &str, release: &GitHubRelease) -> ReleaseManifest {
    let package_asset = select_package_asset(platform, &release.assets);
    let signature = package_asset.and_then(|asset| resolve_release_signature(client, &release.assets, asset));

    ReleaseManifest {
        channel: channel.to_string(),
        platform: platform.to_string(),
        version: normalize_version(&release.tag_name),
        tag_name: release.tag_name.clone(),
        title: release
            .name
            .clone()
            .unwrap_or_else(|| release.tag_name.clone()),
        notes: release.body.clone().unwrap_or_default(),
        package_url: package_asset.map(|asset| asset.browser_download_url.clone()),
        signature,
        html_url: if release.html_url.trim().is_empty() {
            github_release_fallback_url(&release.tag_name)
        } else {
            release.html_url.clone()
        },
        published_at: release
            .published_at
            .clone()
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
    }
}

fn select_package_asset<'a>(
    platform: &str,
    assets: &'a [GitHubReleaseAsset],
) -> Option<&'a GitHubReleaseAsset> {
    preferred_asset_extensions(platform).iter().find_map(|extension| {
        assets
            .iter()
            .find(|asset| asset.name.to_ascii_lowercase().ends_with(extension))
    })
}

fn preferred_asset_extensions(platform: &str) -> &'static [&'static str] {
    match platform {
        "windows-x64" => &[".msi", ".exe"],
        "macos-universal" => &[".dmg", ".pkg"],
        "linux-x64" => &[".deb", ".appimage"],
        _ => &[],
    }
}

fn resolve_release_signature(
    client: &Client,
    assets: &[GitHubReleaseAsset],
    package_asset: &GitHubReleaseAsset,
) -> Option<String> {
    let package_name = package_asset.name.to_ascii_lowercase();
    let exact_checksum_asset = assets.iter().find(|asset| {
        let asset_name = asset.name.to_ascii_lowercase();
        asset_name == format!("{package_name}.sha256")
            || asset_name == format!("{package_name}.sha256.txt")
    });

    let checksum_asset = exact_checksum_asset.or_else(|| {
        assets.iter().find(|asset| {
            let asset_name = asset.name.to_ascii_lowercase();
            asset_name.contains(&package_name)
                && (asset_name.ends_with(".sha256") || asset_name.ends_with(".sha256.txt"))
        })
    })?;

    fetch_checksum_text(client, &checksum_asset.browser_download_url)
        .ok()
        .and_then(|raw| extract_sha256(&raw))
}

fn fetch_checksum_text(client: &Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header(USER_AGENT, GITHUB_USER_AGENT)
        .send()
        .map_err(|error| format!("下载校验文件失败: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "下载校验文件失败，HTTP 状态码 {}",
            response.status()
        ));
    }

    response
        .text()
        .map_err(|error| format!("读取校验文件失败: {error}"))
}

fn extract_sha256(raw: &str) -> Option<String> {
    raw.split_whitespace()
        .map(|token| token.trim_matches(|ch: char| !ch.is_ascii_hexdigit()))
        .find(|candidate| {
            candidate.len() == 64 && candidate.chars().all(|ch| ch.is_ascii_hexdigit())
        })
        .map(|candidate| candidate.to_ascii_lowercase())
}

fn normalize_version(raw: &str) -> String {
    raw.trim().trim_start_matches(['v', 'V']).to_string()
}

fn is_newer_version(current_version: &str, candidate_version: &str) -> bool {
    let current = normalize_version(current_version);
    let candidate = normalize_version(candidate_version);

    match (Version::parse(&current), Version::parse(&candidate)) {
        (Ok(current), Ok(candidate)) => candidate > current,
        _ => current != candidate,
    }
}

fn resolve_release_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        return "windows-x64";
    }

    #[cfg(target_os = "macos")]
    {
        return "macos-universal";
    }

    #[cfg(target_os = "linux")]
    {
        return "linux-x64";
    }

    #[allow(unreachable_code)]
    "unknown"
}
