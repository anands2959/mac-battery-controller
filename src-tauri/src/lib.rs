mod battery;

use tauri::{Manager, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
use tauri::menu::{Menu, MenuItem};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {


            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let quit_i = MenuItem::with_id(app, "quit", "Quit Battery Control", true, None::<&str>)?;
            let reset_i = MenuItem::with_id(app, "reset", "Reset to Normal", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&reset_i, &quit_i])?;

           
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                

                                
                                if let Ok(window_size) = window.outer_size() {
                                    let (rx, ry) = match rect.position {
                                        tauri::Position::Physical(pos) => (pos.x as f64, pos.y as f64),
                                        tauri::Position::Logical(pos) => (pos.x, pos.y),
                                    };
                                    let (rw, rh) = match rect.size {
                                        tauri::Size::Physical(size) => (size.width as f64, size.height as f64),
                                        tauri::Size::Logical(size) => (size.width, size.height),
                                    };

                                    let x = rx + (rw / 2.0) - (window_size.width as f64 / 2.0);
                                    let y = ry + rh + 8.0;
                                    let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "reset" => {
                            crate::battery::reset_and_quit(app.clone());
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                if !focused {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            battery::is_installed,
            battery::install_tools,
            battery::set_limit,
            battery::discharge,
            battery::top_up,
            battery::get_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
