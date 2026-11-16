//! Atlas Launcher Backend - Main Entry Point
//!
//! Punto de entrada de la aplicación Tauri v2.0.

// Evita abrir ventana de consola en Windows cuando no estamos en modo debug.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod launcher;
mod metadata;
mod sagas;
mod scanners;
mod updater;

use tauri::generate_handler;
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tracing::info;
use tracing_subscriber::EnvFilter;

/// Tamaño lógico preferido para la ventana en modo ventana.
const PREFERRED_WIDTH: f64 = 1280.0;
const PREFERRED_HEIGHT: f64 = 760.0;

/// Ajusta la ventana al área útil del monitor (excluye la barra de tareas),
/// la centra y evita que se salga de los límites en cualquier resolución.
fn fit_window_to_work_area(window: &WebviewWindow) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();

    // En Windows, window.inner_size() y outer_size() antes de show() suelen devolver
    // el mismo valor o 0. Estimamos el marco del sistema (bordes laterales ~16px, título ~40px).
    let decor_width = (16.0 * scale).round() as u32;
    let decor_height = (42.0 * scale).round() as u32;

    // Margen de seguridad respecto a los bordes de la pantalla y la barra de tareas
    let margin_x = (16.0 * scale).round() as u32;
    let margin_y = (16.0 * scale).round() as u32;

    let max_inner_width = work_area
        .size
        .width
        .saturating_sub(margin_x * 2 + decor_width)
        .max(640);
    let max_inner_height = work_area
        .size
        .height
        .saturating_sub(margin_y * 2 + decor_height)
        .max(480);

    let inner_width = ((PREFERRED_WIDTH * scale).round() as u32).min(max_inner_width);
    let inner_height = ((PREFERRED_HEIGHT * scale).round() as u32).min(max_inner_height);

    let total_width = inner_width.saturating_add(decor_width);
    let total_height = inner_height.saturating_add(decor_height);

    let center_x = work_area.position.x
        + ((work_area.size.width as i32 - total_width as i32) / 2);
    let center_y = work_area.position.y
        + ((work_area.size.height as i32 - total_height as i32) / 2);

    let final_x = center_x.clamp(
        work_area.position.x + margin_x as i32,
        work_area.position.x + (work_area.size.width as i32 - total_width as i32),
    );
    let final_y = center_y.clamp(
        work_area.position.y + margin_y as i32,
        work_area.position.y + (work_area.size.height as i32 - total_height as i32),
    );

    let _ = window.set_size(PhysicalSize::new(inner_width, inner_height));
    let _ = window.set_position(PhysicalPosition::new(final_x, final_y));
}

/// Inicializa el sistema de logging
pub fn init_logging() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("atlas_launcher=info")),
        )
        .try_init();
}

fn main() {
    tauri::Builder::default()
        .manage(database::DbState::new())
        .invoke_handler(generate_handler![
            commands::init_database,
            commands::scan_libraries,
            commands::list_games,
            commands::get_games_by_saga,
            commands::launch_game,
            commands::launch_emulated_game,
            commands::update_game,
            commands::add_custom_game,
            commands::delete_game,
            commands::save_game_cover,
            commands::fetch_game_metadata,
            commands::fetch_missing_covers,
            commands::get_metadata_settings,
            commands::save_metadata_settings,
            commands::check_update,
            commands::install_update,
            commands::set_fullscreen,
            commands::set_window_size,
        ])
        .setup(|app| {
            init_logging();

            // Ajustar la ventana al área útil del monitor (sin tapar la barra de
            // tareas) y centrarla antes de mostrarla, para que en cualquier
            // resolución quede totalmente visible.
            if let Some(window) = app.get_webview_window("main") {
                fit_window_to_work_area(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Inicializar la base de datos al arrancar y sincronizar portadas pendientes.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<database::DbState>();
                match state.pool().await {
                    Ok(pool) => {
                        info!("Base de datos inicializada correctamente");
                        commands::trigger_background_metadata_fetch(app_handle.clone(), pool.clone());
                    }
                    Err(e) => tracing::error!("Error inicializando base de datos: {}", e),
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al ejecutar la aplicación Tauri");
}
