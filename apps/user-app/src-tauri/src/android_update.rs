use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(target_os = "android")]
use std::{
  fs,
  io::Read,
  mem::ManuallyDrop,
  path::{Path, PathBuf}
};

#[cfg(target_os = "android")]
use jni::{
  objects::{JObject, JString, JValue},
  sys::jobject,
  JNIEnv, JavaVM
};

#[cfg(target_os = "android")]
use reqwest::blocking::Client;

#[cfg(target_os = "android")]
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidRuntimeInfo {
  version: String,
  version_code: i64,
  package_name: String
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateManifest {
  channel: String,
  version: String,
  version_code: i64,
  package_name: String,
  file_name: String,
  download_url: String,
  sha256: String,
  published_at: String,
  notes: String,
  min_supported_version_code: Option<i64>,
  html_url: Option<String>
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateInstallResult {
  ok: bool,
  status: String,
  detail: Option<String>,
  downloaded_file_path: Option<String>
}

pub fn get_runtime_info(app: &AppHandle) -> Result<AndroidRuntimeInfo, String> {
  #[cfg(target_os = "android")]
  {
    let _ = app;
    return with_android_env(|env, activity| read_runtime_info(env, activity));
  }

  #[cfg(not(target_os = "android"))]
  {
    let _ = app;
    Err("当前不是 Android 原生运行环境。".to_string())
  }
}

pub fn install_update(
  app: &AppHandle,
  manifest: AndroidUpdateManifest
) -> AndroidUpdateInstallResult {
  #[cfg(target_os = "android")]
  {
    match install_update_inner(app, &manifest) {
      Ok(result) => result,
      Err(detail) => AndroidUpdateInstallResult {
        ok: false,
        status: "failed".to_string(),
        detail: Some(detail),
        downloaded_file_path: None
      }
    }
  }

  #[cfg(not(target_os = "android"))]
  {
    let _ = app;
    let _ = manifest;

    AndroidUpdateInstallResult {
      ok: false,
      status: "failed".to_string(),
      detail: Some("当前不是 Android 原生运行环境。".to_string()),
      downloaded_file_path: None
    }
  }
}

#[cfg(target_os = "android")]
fn install_update_inner(
  app: &AppHandle,
  manifest: &AndroidUpdateManifest
) -> Result<AndroidUpdateInstallResult, String> {
  let runtime_info = get_runtime_info(app)?;

  if runtime_info.version_code >= manifest.version_code {
    return Ok(AndroidUpdateInstallResult {
      ok: true,
      status: "already_up_to_date".to_string(),
      detail: None,
      downloaded_file_path: None
    });
  }

  let apk_path = download_apk(app, manifest)?;
  if let Err(error) = verify_downloaded_apk(&apk_path, manifest) {
    cleanup_downloaded_apk(&apk_path);
    return Err(error);
  }

  with_android_env(|env, activity| {
    if !can_request_package_installs(env, activity)? {
      open_unknown_sources_settings(env, activity, &runtime_info.package_name)?;
      return Ok(AndroidUpdateInstallResult {
        ok: false,
        status: "permission_required".to_string(),
        detail: Some("请先允许当前应用安装未知来源应用，然后再重试安装。".to_string()),
        downloaded_file_path: Some(apk_path.to_string_lossy().to_string())
      });
    }

    open_installer(env, activity, &runtime_info.package_name, &apk_path)?;
    Ok(AndroidUpdateInstallResult {
      ok: true,
      status: "installer_started".to_string(),
      detail: None,
      downloaded_file_path: Some(apk_path.to_string_lossy().to_string())
    })
  })
}

#[cfg(target_os = "android")]
fn cleanup_downloaded_apk(apk_path: &Path) {
  let _ = fs::remove_file(apk_path);
}

#[cfg(target_os = "android")]
fn with_android_env<T, F>(handler: F) -> Result<T, String>
where
  F: FnOnce(&mut JNIEnv, &JObject) -> Result<T, String>
{
  let android_context = ndk_context::android_context();
  let vm = unsafe { JavaVM::from_raw(android_context.vm().cast()) }
    .map_err(|error| format!("读取 Android VM 失败: {error}"))?;
  let mut env = vm
    .attach_current_thread()
    .map_err(|error| format!("附着 Android 线程失败: {error}"))?;
  let activity = unsafe {
    ManuallyDrop::new(JObject::from_raw(android_context.context() as jobject))
  };

  handler(&mut env, &activity)
}

#[cfg(target_os = "android")]
fn read_runtime_info(env: &mut JNIEnv, activity: &JObject) -> Result<AndroidRuntimeInfo, String> {
  let package_name = read_package_name(env, activity)?;
  let package_info = get_installed_package_info(env, activity, &package_name)?;
  let version_name = read_optional_string_field(env, &package_info, "versionName")?
    .unwrap_or_else(|| "0.0.0".to_string());
  let version_code = env
    .call_method(&package_info, "getLongVersionCode", "()J", &[])
    .and_then(|value| value.j())
    .map_err(|error| format!("读取 Android versionCode 失败: {error}"))?;

  Ok(AndroidRuntimeInfo {
    version: version_name,
    version_code,
    package_name
  })
}

#[cfg(target_os = "android")]
fn read_package_name(env: &mut JNIEnv, activity: &JObject) -> Result<String, String> {
  let package_name = env
    .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])
    .and_then(|value| value.l())
    .map_err(|error| format!("读取 Android 包名失败: {error}"))?;

  read_java_string(env, &package_name)
}

#[cfg(target_os = "android")]
fn get_installed_package_info(
  env: &mut JNIEnv,
  activity: &JObject,
  package_name: &str
) -> Result<JObject, String> {
  let package_manager = get_package_manager(env, activity)?;
  let package_name_java = env
    .new_string(package_name)
    .map_err(|error| format!("创建 Android 包名失败: {error}"))?;
  let package_name_object = JObject::from(package_name_java);
  let package_info = env
    .call_method(
      &package_manager,
      "getPackageInfo",
      "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;",
      &[JValue::Object(&package_name_object), JValue::Int(0)]
    )
    .and_then(|value| value.l())
    .map_err(|error| format!("读取 Android 包信息失败: {error}"))?;

  if package_info.is_null() {
    return Err("当前应用包信息为空。".to_string());
  }

  Ok(package_info)
}

#[cfg(target_os = "android")]
fn get_package_manager(env: &mut JNIEnv, activity: &JObject) -> Result<JObject, String> {
  env
    .call_method(
      activity,
      "getPackageManager",
      "()Landroid/content/pm/PackageManager;",
      &[]
    )
    .and_then(|value| value.l())
    .map_err(|error| format!("读取 Android PackageManager 失败: {error}"))
}

#[cfg(target_os = "android")]
fn read_optional_string_field(
  env: &mut JNIEnv,
  object: &JObject,
  field_name: &str
) -> Result<Option<String>, String> {
  let value = env
    .get_field(object, field_name, "Ljava/lang/String;")
    .and_then(|value| value.l())
    .map_err(|error| format!("读取字段 {field_name} 失败: {error}"))?;

  if value.is_null() {
    return Ok(None);
  }

  Ok(Some(read_java_string(env, &value)?))
}

#[cfg(target_os = "android")]
fn read_java_string(env: &mut JNIEnv, value: &JObject) -> Result<String, String> {
  let java_string = JString::from(value);
  env
    .get_string(&java_string)
    .map(|value| value.to_string_lossy().to_string())
    .map_err(|error| format!("读取 Java 字符串失败: {error}"))
}

#[cfg(target_os = "android")]
fn download_apk(app: &AppHandle, manifest: &AndroidUpdateManifest) -> Result<PathBuf, String> {
  let updates_dir = app
    .path()
    .app_cache_dir()
    .map_err(|error| format!("解析 Android 缓存目录失败: {error}"))?
    .join("updates");
  fs::create_dir_all(&updates_dir).map_err(|error| format!("创建更新缓存目录失败: {error}"))?;

  let target_path = updates_dir.join(&manifest.file_name);
  let client = Client::new();
  let mut response = client
    .get(&manifest.download_url)
    .send()
    .map_err(|error| format!("下载 APK 失败: {error}"))?;

  if !response.status().is_success() {
    return Err(format!("下载 APK 失败，HTTP 状态码 {}", response.status()));
  }

  let mut bytes = Vec::new();
  response
    .copy_to(&mut bytes)
    .map_err(|error| format!("读取 APK 下载响应失败: {error}"))?;
  fs::write(&target_path, bytes).map_err(|error| format!("写入 APK 失败: {error}"))?;

  Ok(target_path)
}

#[cfg(target_os = "android")]
fn verify_downloaded_apk(
  apk_path: &Path,
  manifest: &AndroidUpdateManifest
) -> Result<(), String> {
  let actual_sha256 = sha256_file(apk_path)?;
  let expected_sha256 = normalize_digest(&manifest.sha256);

  if expected_sha256 != actual_sha256 {
    return Err("APK 校验失败，sha256 不匹配。".to_string());
  }

  with_android_env(|env, activity| {
    let package_manager = get_package_manager(env, activity)?;
    let apk_path_java = env
      .new_string(apk_path.to_string_lossy().to_string())
      .map_err(|error| format!("创建 APK 路径失败: {error}"))?;
    let apk_path_object = JObject::from(apk_path_java);
    let package_info = env
      .call_method(
        &package_manager,
        "getPackageArchiveInfo",
        "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;",
        &[JValue::Object(&apk_path_object), JValue::Int(0)]
      )
      .and_then(|value| value.l())
      .map_err(|error| format!("读取 APK 包信息失败: {error}"))?;

    if package_info.is_null() {
      return Err("系统无法识别已下载的 APK。".to_string());
    }

    let package_name = read_optional_string_field(env, &package_info, "packageName")?
      .ok_or_else(|| "APK 缺少包名信息。".to_string())?;
    let version_code = env
      .call_method(&package_info, "getLongVersionCode", "()J", &[])
      .and_then(|value| value.j())
      .map_err(|error| format!("读取 APK versionCode 失败: {error}"))?;

    if package_name != manifest.package_name {
      return Err(format!(
        "APK 包名不匹配，期望 {}，实际 {package_name}",
        manifest.package_name
      ));
    }

    if version_code != manifest.version_code {
      return Err(format!(
        "APK versionCode 不匹配，期望 {}，实际 {version_code}",
        manifest.version_code
      ));
    }

    Ok(())
  })
}

#[cfg(target_os = "android")]
fn sha256_file(path: &Path) -> Result<String, String> {
  let mut file = fs::File::open(path).map_err(|error| format!("读取 APK 失败: {error}"))?;
  let mut hasher = Sha256::new();
  let mut buffer = [0_u8; 16 * 1024];

  loop {
    let bytes_read = file
      .read(&mut buffer)
      .map_err(|error| format!("读取 APK 内容失败: {error}"))?;

    if bytes_read == 0 {
      break;
    }

    hasher.update(&buffer[..bytes_read]);
  }

  Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(target_os = "android")]
fn normalize_digest(value: &str) -> String {
  value
    .trim()
    .strip_prefix("sha256:")
    .unwrap_or(value.trim())
    .to_lowercase()
}

#[cfg(target_os = "android")]
fn can_request_package_installs(env: &mut JNIEnv, activity: &JObject) -> Result<bool, String> {
  let package_manager = get_package_manager(env, activity)?;
  env
    .call_method(&package_manager, "canRequestPackageInstalls", "()Z", &[])
    .and_then(|value| value.z())
    .map_err(|error| format!("检查安装未知来源权限失败: {error}"))
}

#[cfg(target_os = "android")]
fn open_unknown_sources_settings(
  env: &mut JNIEnv,
  activity: &JObject,
  package_name: &str
) -> Result<(), String> {
  let action = env
    .new_string("android.settings.MANAGE_UNKNOWN_APP_SOURCES")
    .map_err(|error| format!("创建权限设置 action 失败: {error}"))?;
  let action_object = JObject::from(action);
  let intent = env
    .new_object(
      "android/content/Intent",
      "(Ljava/lang/String;)V",
      &[JValue::Object(&action_object)]
    )
    .map_err(|error| format!("创建权限设置 Intent 失败: {error}"))?;
  let package_uri = env
    .new_string(format!("package:{package_name}"))
    .map_err(|error| format!("创建权限设置 URI 失败: {error}"))?;
  let package_uri_object = JObject::from(package_uri);
  let uri = env
    .call_static_method(
      "android/net/Uri",
      "parse",
      "(Ljava/lang/String;)Landroid/net/Uri;",
      &[JValue::Object(&package_uri_object)]
    )
    .and_then(|value| value.l())
    .map_err(|error| format!("解析权限设置 URI 失败: {error}"))?;
  let flags = get_int_constant(env, "android/content/Intent", "FLAG_ACTIVITY_NEW_TASK")?;

  env
    .call_method(
      &intent,
      "setData",
      "(Landroid/net/Uri;)Landroid/content/Intent;",
      &[JValue::Object(&uri)]
    )
    .map_err(|error| format!("设置权限设置 URI 失败: {error}"))?;
  env
    .call_method(
      &intent,
      "addFlags",
      "(I)Landroid/content/Intent;",
      &[JValue::Int(flags)]
    )
    .map_err(|error| format!("设置权限设置 flags 失败: {error}"))?;
  env
    .call_method(
      activity,
      "startActivity",
      "(Landroid/content/Intent;)V",
      &[JValue::Object(&intent)]
    )
    .map_err(|error| format!("打开权限设置失败: {error}"))?;

  Ok(())
}

#[cfg(target_os = "android")]
fn open_installer(
  env: &mut JNIEnv,
  activity: &JObject,
  package_name: &str,
  apk_path: &Path
) -> Result<(), String> {
  let authority = env
    .new_string(format!("{package_name}.fileprovider"))
    .map_err(|error| format!("创建 FileProvider authority 失败: {error}"))?;
  let authority_object = JObject::from(authority);
  let apk_path_java = env
    .new_string(apk_path.to_string_lossy().to_string())
    .map_err(|error| format!("创建 APK 路径失败: {error}"))?;
  let apk_path_object = JObject::from(apk_path_java);
  let apk_file = env
    .new_object(
      "java/io/File",
      "(Ljava/lang/String;)V",
      &[JValue::Object(&apk_path_object)]
    )
    .map_err(|error| format!("创建 APK 文件对象失败: {error}"))?;
  let apk_uri = env
    .call_static_method(
      "androidx/core/content/FileProvider",
      "getUriForFile",
      "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
      &[
        JValue::Object(activity),
        JValue::Object(&authority_object),
        JValue::Object(&apk_file)
      ]
    )
    .and_then(|value| value.l())
    .map_err(|error| format!("创建 APK 安装 URI 失败: {error}"))?;
  let intent = env
    .new_object("android/content/Intent", "()V", &[])
    .map_err(|error| format!("创建安装 Intent 失败: {error}"))?;
  let action = env
    .new_string("android.intent.action.VIEW")
    .map_err(|error| format!("创建安装 action 失败: {error}"))?;
  let action_object = JObject::from(action);
  let mime = env
    .new_string("application/vnd.android.package-archive")
    .map_err(|error| format!("创建安装 MIME 失败: {error}"))?;
  let mime_object = JObject::from(mime);
  let new_task = get_int_constant(env, "android/content/Intent", "FLAG_ACTIVITY_NEW_TASK")?;
  let grant_read = get_int_constant(
    env,
    "android/content/Intent",
    "FLAG_GRANT_READ_URI_PERMISSION"
  )?;

  env
    .call_method(
      &intent,
      "setAction",
      "(Ljava/lang/String;)Landroid/content/Intent;",
      &[JValue::Object(&action_object)]
    )
    .map_err(|error| format!("设置安装 action 失败: {error}"))?;
  env
    .call_method(
      &intent,
      "setDataAndType",
      "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
      &[JValue::Object(&apk_uri), JValue::Object(&mime_object)]
    )
    .map_err(|error| format!("设置 APK 安装数据失败: {error}"))?;
  env
    .call_method(
      &intent,
      "addFlags",
      "(I)Landroid/content/Intent;",
      &[JValue::Int(new_task | grant_read)]
    )
    .map_err(|error| format!("设置 APK 安装 flags 失败: {error}"))?;
  env
    .call_method(
      activity,
      "startActivity",
      "(Landroid/content/Intent;)V",
      &[JValue::Object(&intent)]
    )
    .map_err(|error| format!("启动系统安装器失败: {error}"))?;

  Ok(())
}

#[cfg(target_os = "android")]
fn get_int_constant(
  env: &mut JNIEnv,
  class_name: &str,
  field_name: &str
) -> Result<i32, String> {
  env
    .get_static_field(class_name, field_name, "I")
    .and_then(|value| value.i())
    .map_err(|error| format!("读取 Android 常量 {class_name}.{field_name} 失败: {error}"))
}
