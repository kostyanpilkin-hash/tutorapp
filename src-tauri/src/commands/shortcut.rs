use tauri::AppHandle;

#[cfg(target_os = "windows")]
fn resolve_shortcut_target() -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    use std::path::PathBuf;

    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let current_dir = current.parent().map(PathBuf::from).unwrap_or_default();

    // Release-сборка рядом с debug: target/release/tutor-app.exe
    let release = current_dir
        .parent()
        .map(|p| p.join("release").join("tutor-app.exe"))
        .unwrap_or_default();

    if release.exists() {
        let work_dir = release.parent().map(PathBuf::from).unwrap_or(current_dir);
        return Ok((release, work_dir));
    }

    // Запуск из release напрямую
    if current.to_string_lossy().contains("\\release\\") {
        return Ok((current.clone(), current_dir));
    }

    // Установленная / любая другая копия — ярлык на текущий exe
    Ok((current, current_dir))
}

#[cfg(target_os = "windows")]
fn write_shortcut(
    exe: &std::path::Path,
    work_dir: &std::path::Path,
    icon_path: Option<&std::path::Path>,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let desktop = dirs::desktop_dir().ok_or("Не удалось найти рабочий стол")?;
    let shortcut = desktop.join("TutorApp.lnk");

    let icon_location = icon_path
        .map(|p| format!("{},0", p.to_string_lossy()))
        .unwrap_or_else(|| format!("{},0", exe.to_string_lossy()));

    let esc = |s: &str| s.replace('\'', "''");

    let ps = format!(
        "$s = (New-Object -COM WScript.Shell).CreateShortcut('{}'); \
         $s.TargetPath = '{}'; \
         $s.WorkingDirectory = '{}'; \
         $s.Description = 'TutorApp — календарь репетитора'; \
         $s.IconLocation = '{}'; \
         $s.Save()",
        esc(&shortcut.to_string_lossy()),
        esc(&exe.to_string_lossy()),
        esc(&work_dir.to_string_lossy()),
        esc(&icon_location),
    );

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &ps,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn ensure_desktop_shortcut(_app: &AppHandle) -> Result<(), String> {
    let (exe, work_dir) = resolve_shortcut_target()?;
    // Обновляем существующий ярлык, чтобы путь и иконка всегда соответствовали текущей сборке
    let icon = crate::windows_toast::toast_icon_path_for_shortcut();
    write_shortcut(&exe, &work_dir, icon.as_deref())
}

#[cfg(not(target_os = "windows"))]
pub fn ensure_desktop_shortcut(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn create_desktop_shortcut(app: AppHandle) -> Result<(), String> {
    ensure_desktop_shortcut(&app)
}
