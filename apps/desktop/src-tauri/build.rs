use std::fs;
use std::path::Path;

fn main() {
    // 让 Cargo 正确感知前端产物变化。
    // 否则 user-app 已经重新 build 了，desktop 壳仍可能复用旧的嵌入资源。
    watch_dir("../user-app/dist");

    tauri_build::build()
}

fn watch_dir(path: &str) {
    let root = Path::new(path);
    if !root.exists() {
        return;
    }

    walk_and_watch(root);
}

fn walk_and_watch(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        walk_and_watch(&entry.path());
    }
}
