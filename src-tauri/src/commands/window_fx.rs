use tauri::WebviewWindow;

/// Applies a native window backdrop: "mica" (Win11), "acrylic" (Win10+),
/// or none. Falls back silently where unsupported.
#[tauri::command]
pub fn set_window_effect(window: WebviewWindow, effect: Option<String>, dark: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};
        let _ = clear_mica(&window);
        let _ = clear_acrylic(&window);
        match effect.as_deref() {
            Some("mica") => apply_mica(&window, Some(dark)).map_err(|e| e.to_string()),
            Some("acrylic") => {
                let tint = if dark { (18, 18, 18, 125) } else { (250, 250, 250, 125) };
                apply_acrylic(&window, Some(tint)).map_err(|e| e.to_string())
            }
            _ => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (window, effect, dark);
        Ok(())
    }
}
