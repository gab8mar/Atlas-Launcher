use tauri::{command, State};

use crate::database::{self, DbState, GameRow};
use crate::launcher;
use crate::metadata;
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

/// Comando: Actualizar información de un juego manualmente
#[command]
pub async fn update_game(
    state: State<'_, DbState>,
    id: i64,
    name: String,
    saga: Option<String>,
    release_year: Option<i32>,
    console: Option<String>,
    executable_path: String,
    arguments: Option<String>,
    cover_path: Option<String>,
) -> Result<String, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    database::update_game(
        pool,
        id,
        &name,
        saga.as_deref(),
        release_year,
        console.as_deref(),
        &executable_path,
        arguments.as_deref(),
        cover_path.as_deref(),
    )
    .await
    .map(|_| "Juego actualizado".to_string())
    .map_err(|e| format!("Error actualizando juego: {}", e))
}

/// Comando: Añadir juego manual
#[command]
pub async fn add_custom_game(
    state: State<'_, DbState>,
    name: String,
    platform: Option<String>,
    executable_path: String,
    arguments: Option<String>,
    saga: Option<String>,
    console: Option<String>,
    release_year: Option<i32>,
    cover_path: Option<String>,
) -> Result<i64, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    let platform = platform.unwrap_or_else(|| "custom".to_string());

    database::add_custom_game(
        pool,
        &name,
        &platform,
        &executable_path,
        arguments.as_deref(),
        saga.as_deref(),
        console.as_deref(),
        release_year,
        cover_path.as_deref(),
    )
    .await
    .map_err(|e| format!("Error agregando juego: {}", e))
}

/// Comando: Eliminar juego
#[command]
pub async fn delete_game(state: State<'_, DbState>, id: i64) -> Result<String, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    database::delete_game(pool, id)
        .await
        .map(|_| "Juego eliminado".to_string())
        .map_err(|e| format!("Error eliminando juego: {}", e))
}

/// Comando: Guardar carátula personalizada (desde URL o Base64/Bytes)
#[command]
pub async fn save_game_cover(
    state: State<'_, DbState>,
    game_id: i64,
    source_url_or_path: String,
) -> Result<String, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    let client = metadata::MetadataClient::default();
    let saved_path = if source_url_or_path.starts_with("http://")
        || source_url_or_path.starts_with("https://")
    {
        client
            .download_cover(&source_url_or_path, game_id)
            .await
            .map_err(|e| format!("Error descargando carátula: {}", e))?
    } else {
        std::path::PathBuf::from(&source_url_or_path)
    };

    let path_str = saved_path.to_string_lossy().to_string();

    sqlx::query("UPDATE games SET cover_path = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2")
        .bind(&path_str)
        .bind(game_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Error guardando ruta de carátula: {}", e))?;

    Ok(path_str)
}

/// Comando: Lanzar juego nativo o por URI con registro de tiempo de juego
#[command]
pub async fn launch_game(
    state: State<'_, DbState>,
    game_id: Option<i64>,
    executable: String,
    arguments: Option<String>,
    working_directory: Option<String>,
) -> Result<launcher::LaunchResult, String> {
    let manager = launcher::LauncherManager::new();

    let is_uri = executable.contains("://");
    let result = if is_uri {
        manager.launch_uri(&executable).await?
    } else {
        manager
            .launch_native(
                &executable,
                arguments.as_deref(),
                working_directory.as_deref(),
            )
            .await?
    };

    if result.success {
        if let Some(id) = game_id {
            if let Ok(pool) = state.pool().await {
                let _ = database::record_playtime(pool, id, 1).await;
            }
        }
    }

    Ok(result)
}

/// Comando: Lanzar juego emulado (ROM/ISO)
#[command]
pub async fn launch_emulated_game(
    state: State<'_, DbState>,
    game_id: Option<i64>,
    emulator_path: String,
    rom_iso_path: String,
    emulator_args: Option<String>,
) -> Result<launcher::LaunchResult, String> {
    let manager = launcher::LauncherManager::new();
    let result = manager
        .launch_emulated(&emulator_path, &rom_iso_path, emulator_args.as_deref())
        .await?;

    if result.success {
        if let Some(id) = game_id {
            if let Ok(pool) = state.pool().await {
                let _ = database::record_playtime(pool, id, 1).await;
            }
        }
    }

    Ok(result)
}
