//! Windows toast identity: register AppUserModelID so notifications show as TutorApp
//! (name + icon) instead of "Windows PowerShell".
//!
//! tauri-plugin-notification only sets `app_id` when the exe is *not* under
//! `target/debug` or `target/release`, so we send toasts via notify-rust ourselves.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const ICON_BYTES: &[u8] = include_bytes!("../icons/icon.ico");

fn toast_icon_path() -> Result<PathBuf, String> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| "Не удалось найти LocalAppData".to_string())?
        .join("TutorApp");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("app-icon.ico");
    if fs::read(&path).ok().as_deref() != Some(ICON_BYTES) {
        fs::write(&path, ICON_BYTES).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Register AUMID in HKCU and bind it to the current process.
pub fn ensure_app_toast_identity(app: &AppHandle) -> Result<(), String> {
    let identifier = app.config().identifier.clone();
    let display_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "TutorApp".into());
    let icon = toast_icon_path()?;
    let icon_uri = icon.to_string_lossy().replace('/', "\\");

    register_aumid_registry(&identifier, &display_name, &icon_uri)?;
    set_process_aumid(&identifier)?;
    Ok(())
}

fn register_aumid_registry(
    aumid: &str,
    display_name: &str,
    icon_uri: &str,
) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!(r"Software\Classes\AppUserModelId\{aumid}");
    let (key, _) = hkcu
        .create_subkey(&path)
        .map_err(|e| format!("Регистрация AUMID: {e}"))?;
    key.set_value("DisplayName", &display_name)
        .map_err(|e| e.to_string())?;
    key.set_value("IconUri", &icon_uri)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn set_process_aumid(aumid: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    let wide: Vec<u16> = std::ffi::OsStr::new(aumid)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // HRESULT; S_OK == 0
    let hr = unsafe { SetCurrentProcessExplicitAppUserModelID(wide.as_ptr()) };
    if hr < 0 {
        return Err(format!("SetCurrentProcessExplicitAppUserModelID HRESULT=0x{hr:08X}"));
    }
    Ok(())
}

#[link(name = "shell32")]
unsafe extern "system" {
    fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
}

/// Show a toast that always uses the app AUMID + icon (works from target/release too).
pub fn show_app_toast(app: &AppHandle, title: &str, body: &str) {
    let identifier = app.config().identifier.clone();
    let icon = toast_icon_path().ok();

    let mut notification = notify_rust::Notification::new();
    notification.summary(title);
    notification.body(body);
    notification.app_id(&identifier);
    if let Some(ref path) = icon {
        notification.icon(path.to_string_lossy().as_ref());
    }

    if let Err(e) = notification.show() {
        eprintln!("Toast error: {e}");
    }
}

pub fn toast_icon_path_for_shortcut() -> Option<PathBuf> {
    toast_icon_path().ok()
}
