use tauri::{command, State};

use crate::database::{self, DbState, GameRow};
use crate::launcher;
use crate::sagas::{self, GroupingResult};
use crate::scanners::{self, DetectedGame, ScanResult};

/// Comando: Inicializar base de datos
#[command]
pub async fn init_database(state: State<'_, DbState>) -> Result<String, String> {
    database::init(&state)
        .await
        .map(|_| "Base de datos inicializada".to_string())
        .map_err(|e| format!("Error inicializando DB: {}", e))
}

/// Comando: Ejecutar escaneo completo y guardar resultados
#[command]
pub async fn scan_libraries(state: State<'_, DbState>) -> Result<ScanResult, String> {
    let outcome = tokio::task::spawn_blocking(scanners::full_scan)
        .await
        .map_err(|e| format!("Error en escaneo: {}", e))?;

    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    let mut result = outcome.result;
    match database::save_games(pool, &outcome.games).await {
        Ok(saved) => result.games_found = saved,
        Err(e) => result
            .errors
            .push(format!("No se pudo guardar el escaneo: {}", e)),
    }

    Ok(result)
}

/// Comando: Listar todos los juegos instalados
#[command]
pub async fn list_games(state: State<'_, DbState>) -> Result<Vec<GameRow>, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    database::list_games(pool)
        .await
        .map_err(|e| format!("Error leyendo juegos: {}", e))
}

/// Comando: Obtener juegos agrupados por saga
#[command]
pub async fn get_games_by_saga(state: State<'_, DbState>) -> Result<GroupingResult, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    let rows = database::list_games(pool)
        .await
        .map_err(|e| format!("Error leyendo juegos: {}", e))?;

    let detected: Vec<DetectedGame> = rows
        .into_iter()
        .map(|row| DetectedGame {
            name: row.name,
            platform: row.platform,
            executable_path: if row.executable_path.is_empty() {
                None
            } else {
                Some(row.executable_path)
            },
            rom_iso_path: row.rom_iso_path,
            saga: row.saga,
            console: row.console,
            release_year: row.release_year,
        })
        .collect();

    Ok(sagas::group_by_saga(&detected))
}

/// Comando: Lanzar juego nativo o por URI
#[command]
pub async fn launch_game(
    executable: String,
    arguments: Option<String>,
    working_directory: Option<String>,
) -> Result<launcher::LaunchResult, String> {
    let manager = launcher::LauncherManager::new();

    let is_uri = executable.contains("://");
    if is_uri {
        manager.launch_uri(&executable).await
    } else {
        manager
            .launch_native(
                &executable,
                arguments.as_deref(),
                working_directory.as_deref(),
            )
            .await
    }
}

/// Comando: Lanzar juego emulado (ROM/ISO)
#[command]
pub async fn launch_emulated_game(
    emulator_path: String,
    rom_iso_path: String,
    emulator_args: Option<String>,
) -> Result<launcher::LaunchResult, String> {
    let manager = launcher::LauncherManager::new();
    manager
        .launch_emulated(&emulator_path, &rom_iso_path, emulator_args.as_deref())
        .await
}
