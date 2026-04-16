use chrono::Utc;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::sync::mpsc;
use std::process::Command;
#[cfg(target_os = "macos")]
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSView, NSWindow, NSWindowButton};

const GITHUB_RELEASES_OWNER: &str = "jingyi0605";
const GITHUB_RELEASES_REPO: &str = "CodingNS";
const STABLE_UPDATER_MANIFEST_URL: &str =
  "https://github.com/jingyi0605/CodingNS/releases/latest/download/latest.json";

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
  pub window_chrome: Option<DesktopWindowChromeInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindowChromeInfo {
  pub macos_titlebar: Option<MacOsTitlebarMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacOsTitlebarMetrics {
  pub overlay: bool,
  pub traffic_light_center_y: f64,
  pub traffic_light_leading_inset: f64,
  pub traffic_light_safe_zone_width: f64,
  pub traffic_light_button_diameter: f64,
  pub titlebar_height: f64,
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

pub fn get_runtime_info(app: &AppHandle) -> DesktopRuntimeInfo {
  DesktopRuntimeInfo {
    version: app.package_info().version.to_string(),
    app_data_dir: app
      .path()
      .app_data_dir()
      .ok()
      .map(|path| path.to_string_lossy().to_string()),
    window_chrome: collect_window_chrome_info(app),
  }
}

#[cfg(target_os = "macos")]
fn collect_window_chrome_info(app: &AppHandle) -> Option<DesktopWindowChromeInfo> {
  let window = app.get_webview_window("main")?;
  let main_thread_window = window.clone();
  let (sender, receiver) = mpsc::sync_channel(1);

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
      macos_titlebar: Some(macos_titlebar),
    })
}

#[cfg(not(target_os = "macos"))]
fn collect_window_chrome_info(_app: &AppHandle) -> Option<DesktopWindowChromeInfo> {
  None
}

#[cfg(target_os = "macos")]
unsafe fn read_macos_titlebar_metrics(
  window: &tauri::WebviewWindow,
) -> Option<MacOsTitlebarMetrics> {
  let ns_window_ptr = window.ns_window().ok()?;
  let ns_window: &NSWindow = &*ns_window_ptr.cast();
  let close = ns_window.standardWindowButton(NSWindowButton::CloseButton)?;
  let miniaturize = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)?;
  let close_parent = close.superview()?;
  let trailing_button = ns_window
    .standardWindowButton(NSWindowButton::ZoomButton)
    .unwrap_or(miniaturize.clone());
  let trailing_parent = trailing_button.superview()?;
  let title_bar_container_view = close_parent.superview()?;
  let title_bar_rect = NSView::frame(&title_bar_container_view);
  let close_rect =
    close_parent.convertRect_toView(NSView::frame(&close), Some(&title_bar_container_view));
  let trailing_rect = trailing_parent.convertRect_toView(
    NSView::frame(&trailing_button),
    Some(&title_bar_container_view),
  );

  if close_rect.size.height <= 0.0 || title_bar_rect.size.height <= 0.0 {
    return None;
  }

  let button_center_y_from_bottom = close_rect.origin.y + (close_rect.size.height / 2.0);
  let button_center_y = if title_bar_container_view.isFlipped() {
    button_center_y_from_bottom
  } else {
    title_bar_rect.size.height - button_center_y_from_bottom
  };
  let trailing_edge = trailing_rect.origin.x + trailing_rect.size.width;

  Some(MacOsTitlebarMetrics {
    overlay: true,
    traffic_light_center_y: round_layout_value(button_center_y),
    traffic_light_leading_inset: round_layout_value(trailing_edge + 8.0),
    traffic_light_safe_zone_width: round_layout_value(trailing_edge + 16.0),
    traffic_light_button_diameter: round_layout_value(close_rect.size.height),
    titlebar_height: round_layout_value(title_bar_rect.size.height),
  })
}

fn round_layout_value(value: f64) -> f64 {
  (value * 100.0).round() / 100.0
}

pub async fn check_for_update(
  app: &AppHandle,
  channel: &str,
) -> Result<DesktopReleaseState, String> {
  let runtime_info = get_runtime_info(app);
  let current_version = runtime_info.version.clone();
  let updater = build_updater(app, channel)?;
  let update = updater
    .check()
    .await
    .map_err(|error| format!("检查桌面更新失败: {error}"))?;
  let manifest = update.map(|update| map_release_manifest(channel, update));

  Ok(DesktopReleaseState {
    checked_at: Utc::now().to_rfc3339(),
    current_version,
    has_update: manifest.is_some(),
    manifest,
    runtime_info,
  })
}

pub async fn install_update(app: &AppHandle, channel: &str) -> UpdateInstallResult {
  match install_update_inner(app, channel).await {
    Ok(()) => UpdateInstallResult {
      ok: true,
      error_code: None,
      detail: None,
      downloaded_file_path: None,
    },
    Err(detail) => UpdateInstallResult {
      ok: false,
      error_code: Some("UPDATE_ERROR".to_string()),
      detail: Some(detail),
      downloaded_file_path: None,
    },
  }
}

async fn install_update_inner(app: &AppHandle, channel: &str) -> Result<(), String> {
  let updater = build_updater(app, channel)?;
  let Some(update) = updater
    .check()
    .await
    .map_err(|error| format!("检查桌面更新失败: {error}"))?
  else {
    return Err("当前已经是最新版本。".to_string());
  };

  update
    .download_and_install(
      |_downloaded, _content_length| {},
      || {},
    )
    .await
    .map_err(|error| format!("安装桌面更新失败: {error}"))?;

  Ok(())
}

fn build_updater(
  app: &AppHandle,
  channel: &str,
) -> Result<tauri_plugin_updater::Updater, String> {
  let pubkey = resolve_updater_public_key()?;
  let endpoint = resolve_updater_endpoint(channel);
  let builder = app
    .updater_builder()
    .pubkey(pubkey)
    .endpoints(vec![
      endpoint
        .parse()
        .map_err(|error| format!("解析 updater endpoint 失败: {error}"))?,
    ])
    .map_err(|error| format!("配置 updater endpoint 失败: {error}"))?;

  #[cfg(target_os = "macos")]
  let builder = builder.target("macos-universal");

  builder
    .build()
    .map_err(|error| format!("初始化桌面 updater 失败: {error}"))
}

fn resolve_updater_public_key() -> Result<String, String> {
  if let Some(value) = option_env!("CODINGNS_TAURI_UPDATER_PUBLIC_KEY") {
    if !value.trim().is_empty() {
      return Ok(value.trim().to_string());
    }
  }

  Err("未配置桌面 updater 公钥，请在构建时提供 CODINGNS_TAURI_UPDATER_PUBLIC_KEY。".to_string())
}

fn resolve_updater_endpoint(channel: &str) -> String {
  let _ = channel;
  STABLE_UPDATER_MANIFEST_URL.to_string()
}

fn map_release_manifest(channel: &str, update: tauri_plugin_updater::Update) -> ReleaseManifest {
  let version = update.version.to_string();

  ReleaseManifest {
    channel: channel.to_string(),
    platform: resolve_release_platform().to_string(),
    version: version.clone(),
    tag_name: resolve_release_tag_name(&version),
    title: format!("v{version}"),
    notes: update.body.unwrap_or_default(),
    package_url: None,
    signature: None,
    html_url: format!(
      "https://github.com/{}/{}/releases/tag/{}",
      GITHUB_RELEASES_OWNER,
      GITHUB_RELEASES_REPO,
      resolve_release_tag_name(&version)
    ),
    published_at: update.date.map(|value| value.to_string()).unwrap_or_default(),
  }
}

fn resolve_release_tag_name(version: &str) -> String {
  if version.starts_with('v') {
    version.to_string()
  } else {
    format!("v{version}")
  }
}

fn resolve_release_platform() -> &'static str {
  #[cfg(target_os = "macos")]
  {
    "macos-universal"
  }

  #[cfg(target_os = "windows")]
  {
    "windows-x86_64"
  }

  #[cfg(target_os = "linux")]
  {
    "linux-x86_64"
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
