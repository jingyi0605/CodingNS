use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: u32,
    pub height: u32,
    pub min_width: u32,
    pub min_height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowDescriptor {
    pub window_id: String,
    pub kind: WindowKind,
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
    pub session_id: Option<String>,
    pub mode: WindowMode,
    pub bounds: WindowBounds,
    pub focus_owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WindowKind {
    Chat,
    Files,
    Git,
    Processes,
    Terminals,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WindowMode {
    Docked,
    Floating,
    External,
}

#[derive(Debug, Default)]
struct WindowRegistry {
    descriptors: BTreeMap<String, WindowDescriptor>,
    open_window_ids: Vec<String>,
    last_active_window_id: Option<String>,
}

#[derive(Debug, Default)]
pub struct WindowManagerState {
    registry: Mutex<WindowRegistry>,
}

impl WindowManagerState {
    pub fn list_descriptors(&self) -> Vec<WindowDescriptor> {
        self.lock_registry().descriptors.values().cloned().collect()
    }

    pub fn get_descriptor(&self, window_id: &str) -> Option<WindowDescriptor> {
        self.lock_registry().descriptors.get(window_id).cloned()
    }

    pub fn sync_descriptor(&self, descriptor: WindowDescriptor) {
        let mut registry = self.lock_registry();
        registry
            .descriptors
            .insert(descriptor.window_id.clone(), descriptor);
    }

    pub fn update_bounds(&self, window_id: &str, bounds: WindowBounds) -> Result<(), String> {
        let mut registry = self.lock_registry();
        let descriptor = registry.descriptors.get_mut(window_id).ok_or_else(|| {
            window_manager_error(
                "WINDOW_DESCRIPTOR_NOT_FOUND",
                format!("找不到窗口描述：{window_id}"),
            )
        })?;
        descriptor.bounds = bounds;
        Ok(())
    }

    pub fn mark_window_open(&self, window_id: &str) {
        let mut registry = self.lock_registry();
        registry.open_window_ids.retain(|id| id != window_id);
        registry.open_window_ids.push(window_id.to_string());
        registry.last_active_window_id = Some(window_id.to_string());
    }

    pub fn mark_window_closed(&self, window_id: &str) {
        let mut registry = self.lock_registry();
        registry.open_window_ids.retain(|id| id != window_id);

        if registry
            .last_active_window_id
            .as_deref()
            .is_some_and(|active_id| active_id == window_id)
        {
            registry.last_active_window_id = registry.open_window_ids.last().cloned();
        }
    }

    pub fn is_open(&self, window_id: &str) -> bool {
        self.lock_registry()
            .open_window_ids
            .iter()
            .any(|id| id == window_id)
    }

    fn lock_registry(&self) -> MutexGuard<'_, WindowRegistry> {
        self.registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl WindowDescriptor {
    pub fn supports_external_window(&self) -> bool {
        self.mode != WindowMode::External
            || matches!(
                self.kind,
                WindowKind::Files | WindowKind::Git | WindowKind::Processes | WindowKind::Terminals
            )
    }
}

pub fn window_manager_error(code: &str, detail: impl Into<String>) -> String {
    format!("{code}: {}", detail.into())
}

#[cfg(test)]
mod tests {
    use super::{WindowBounds, WindowDescriptor, WindowKind, WindowManagerState, WindowMode};

    fn create_descriptor(window_id: &str, kind: WindowKind) -> WindowDescriptor {
        WindowDescriptor {
            window_id: window_id.to_string(),
            kind,
            workspace_id: Some("workspace-1".to_string()),
            workspace_name: Some("项目一".to_string()),
            session_id: None,
            mode: WindowMode::External,
            bounds: WindowBounds {
                x: Some(20),
                y: Some(30),
                width: 1200,
                height: 800,
                min_width: 720,
                min_height: 480,
            },
            focus_owner: None,
        }
    }

    #[test]
    fn sync_and_list_descriptors_are_stable() {
        let state = WindowManagerState::default();
        state.sync_descriptor(create_descriptor("window-b", WindowKind::Git));
        state.sync_descriptor(create_descriptor("window-a", WindowKind::Files));

        let listed = state.list_descriptors();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].window_id, "window-a");
        assert_eq!(listed[1].window_id, "window-b");
    }

    #[test]
    fn update_bounds_replaces_existing_descriptor_bounds() {
        let state = WindowManagerState::default();
        state.sync_descriptor(create_descriptor("window-files", WindowKind::Files));

        state
            .update_bounds(
                "window-files",
                WindowBounds {
                    x: Some(80),
                    y: Some(90),
                    width: 1600,
                    height: 960,
                    min_width: 720,
                    min_height: 520,
                },
            )
            .unwrap();

        let descriptor = state.get_descriptor("window-files").unwrap();
        assert_eq!(descriptor.bounds.width, 1600);
        assert_eq!(descriptor.bounds.min_height, 520);
    }

    #[test]
    fn open_and_close_state_keeps_last_active_window() {
        let state = WindowManagerState::default();
        state.sync_descriptor(create_descriptor("window-files", WindowKind::Files));
        state.sync_descriptor(create_descriptor("window-git", WindowKind::Git));

        state.mark_window_open("window-files");
        state.mark_window_open("window-git");
        assert!(state.is_open("window-files"));
        assert!(state.is_open("window-git"));

        state.mark_window_closed("window-git");
        assert!(!state.is_open("window-git"));
        assert!(state.is_open("window-files"));
    }

    #[test]
    fn external_window_scope_is_limited_to_first_batch() {
        assert!(create_descriptor("window-files", WindowKind::Files).supports_external_window());
        assert!(!create_descriptor("window-chat", WindowKind::Chat).supports_external_window());
        assert!(create_descriptor("window-git", WindowKind::Git).supports_external_window());
        assert!(create_descriptor("window-terminals", WindowKind::Terminals).supports_external_window());
    }
}
