mod commands;
mod db;
mod http_server;
mod models;
mod recurrence;
mod scheduler;
#[cfg(windows)]
mod windows_toast;

use commands::{finance::*, lessons::*, reminders::*, settings::*, shortcut::*, students::*, students_bulk::*, window_fx::*};
use db::{init_db, AppState};
use scheduler::start_scheduler;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = init_db().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // If user launches the app again, focus the already opened window.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_lessons,
            get_lesson,
            create_lesson,
            update_lesson,
            delete_lesson,
            delete_lesson_series,
            delete_lesson_series_from_instance,
            restore_lesson_archive,
            update_lesson_status,
            check_overlaps,
            get_today_lessons,
            get_fired_reminders,
            get_settings,
            set_setting,
            get_db_path,
            backup_database,
            snooze_reminder,
            create_desktop_shortcut,
            get_finance_report,
            get_debt_lessons,
            mark_debt_paid,
            get_students,
            get_student,
            create_student,
            update_student,
            archive_student,
            pick_student_photo,
            remove_student_photo,
            get_student_lessons,
            get_student_finance,
            update_student_lessons_currency,
            count_student_lessons_for_link_update,
            update_student_lessons_link,
            get_student_settings_log,
            get_activity_log,
            set_window_effect,
            http_server::get_phone_link,
            http_server::get_phone_links,
            http_server::reset_phone_key,
            http_server::set_phone_server,
            apply_prepaid_lessons,
            get_student_photo_data_url,
        ])
        .setup(|app| {
            http_server::maybe_start();
            let open_item = MenuItem::with_id(app, "open", "Открыть", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("TutorApp");
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        if let Some(state) = app.try_state::<AppState>() {
                            state.scheduler_running.store(false, std::sync::atomic::Ordering::Relaxed);
                        }
                        app.exit(0)
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            #[cfg(windows)]
            if let Err(e) = windows_toast::ensure_app_toast_identity(app.handle()) {
                eprintln!("Toast identity setup: {e}");
            }
            #[cfg(windows)]
            if let Err(e) = commands::shortcut::refresh_desktop_shortcut_if_exists(app.handle()) {
                eprintln!("Desktop shortcut setup: {e}");
            }
            // Ask once so Windows allows branded toasts.
            let _ = app.notification().request_permission();

            if let Some(state) = app.try_state::<AppState>() {
                start_scheduler(app.handle().clone(), state.scheduler_running.clone());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
