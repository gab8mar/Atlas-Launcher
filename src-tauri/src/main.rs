//! Atlas Launcher Backend - Main Entry Point
//!
//! Punto de entrada de la aplicación Tauri v2.0.

mod commands;
mod database;
mod launcher;
mod metadata;
mod sagas;
mod scanners;

use tauri::generate_handler;
use tauri::Manager;
use tracing::info;
use tracing_subscriber::EnvFilter;

/// Inicializa el sistema de logging
pub fn init_logging() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("atlas_launcher=info")),
        )
        .init();
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
        ])
        .setup(|app| {
            init_logging();

            // Inicializar la base de datos al arrancar.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<database::DbState>();
                match database::init(&state).await {
                    Ok(_) => info!("Base de datos inicializada correctamente"),
                    Err(e) => tracing::error!("Error inicializando base de datos: {}", e),
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al ejecutar la aplicación Tauri");
}
