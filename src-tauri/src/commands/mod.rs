use tauri::{command, AppHandle, Emitter, Manager, State};

use crate::database::{self, DbState, GameRow, MetadataUpsert};
use crate::launcher;
use crate::metadata;
use crate::sagas::{self, GroupingResult};
use crate::scanners::{self, DetectedGame, ScanResult};
use crate::updater;

/// Progreso de la descarga masiva de portadas.
const METADATA_PROGRESS_EVENT: &str = "atlas-metadata-progress";

/// Carpeta donde se guardan las imágenes descargadas (visible por el protocolo asset).
fn covers_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("covers"))
        .unwrap_or_else(|_| metadata::config_dir().join("covers"))
}

/// Resultado de enriquecer un juego con metadatos externos.
#[derive(Debug, serde::Serialize)]
pub struct MetadataFetchResult {
    pub game_id: i64,
    pub source: Option<String>,
    pub release_year: Option<i32>,
    pub console: Option<String>,
    pub genre: Option<String>,
    pub rating: Option<f64>,
    pub cover_path: Option<String>,
    pub banner_path: Option<String>,
    pub logo_path: Option<String>,
    pub warnings: Vec<String>,
}

/// Resultado de la descarga masiva de portadas.
#[derive(Debug, Default, serde::Serialize)]
pub struct MetadataBulkResult {
    pub total: usize,
    pub updated: usize,
    pub failed: usize,
}

/// Progreso enviado al frontend durante la descarga masiva.
#[derive(Debug, Clone, serde::Serialize)]
struct MetadataProgress {
    processed: usize,
    total: usize,
    game_id: i64,
    name: String,
    cover_path: Option<String>,
    error: Option<String>,
}

/// Ajustes de metadatos visibles desde la interfaz (nunca devuelve secretos).
#[derive(Debug, serde::Serialize)]
pub struct MetadataSettingsView {
    pub igdb_client_id: Option<String>,
    pub igdb_configured: bool,
    pub steamgriddb_configured: bool,
    pub credentials_path: String,
}

fn settings_view() -> MetadataSettingsView {
    let credentials = metadata::load_credentials();
    let igdb_configured = credentials.has_igdb();
    let steamgriddb_configured = credentials.has_steamgriddb();

    MetadataSettingsView {
        igdb_client_id: credentials.igdb_client_id,
        igdb_configured,
        steamgriddb_configured,
        credentials_path: metadata::config_dir()
            .join("metadata.json")
            .to_string_lossy()
            .to_string(),
    }
}

async fn download_optional(
    client: &metadata::MetadataClient,
    url: Option<&str>,
    game_id: i64,
    kind: &str,
    warnings: &mut Vec<String>,
) -> Option<String> {
    let url = url?;
    match client.download_art(url, game_id, kind).await {
        Ok(path) => Some(path.to_string_lossy().to_string()),
        Err(err) => {
            warnings.push(format!("{}: {}", kind, err));
            None
        }
    }
}

/// Busca y guarda metadatos/arte de un juego concreto.
async fn enrich_game(
    client: &metadata::MetadataClient,
    pool: &sqlx::SqlitePool,
    game_id: i64,
    name: &str,
) -> Result<MetadataFetchResult, String> {
    let mut warnings = Vec::new();

    let mut info = None;
    if client.has_igdb() {
        match client.search_igdb(name).await {
            Ok(found) => info = found,
            Err(err) => warnings.push(format!("IGDB: {}", err)),
        }
    }

    let mut artwork = None;
    if client.has_steamgriddb() {
        match client.search_steamgriddb(name).await {
            Ok(found) => artwork = found,
            Err(err) => warnings.push(format!("SteamGridDB: {}", err)),
        }
    }

    // Si no hay portada de IGDB o SteamGridDB, consultar Steam Store (público y sin credenciales)
    if artwork.as_ref().and_then(|a| a.cover_url.as_ref()).is_none()
        && info.as_ref().and_then(|m| m.cover_url.as_ref()).is_none()
    {
        if let Ok(Some(steam_art)) = client.search_steam_store(name).await {
            if artwork.is_none() {
                artwork = Some(steam_art);
            } else if let Some(ref mut art) = artwork {
                art.cover_url = steam_art.cover_url;
            }
        }
    }

    if info.is_none() && artwork.is_none() {
        return Err(if warnings.is_empty() {
            format!("Sin resultados para \"{}\"", name)
        } else {
            warnings.join(" · ")
        });
    }

    let cover_url = artwork
        .as_ref()
        .and_then(|art| art.cover_url.as_deref())
        .or_else(|| info.as_ref().and_then(|meta| meta.cover_url.as_deref()))
        .map(|url| url.to_string());
    let banner_url = artwork
        .as_ref()
        .and_then(|art| art.banner_url.clone())
        .or_else(|| info.as_ref().and_then(|meta| meta.banner_url.clone()));
    let logo_url = artwork
        .as_ref()
        .and_then(|art| art.logo_url.clone())
        .or_else(|| info.as_ref().and_then(|meta| meta.logo_url.clone()));

    let cover_path = download_optional(
        client,
        cover_url.as_deref(),
        game_id,
        "cover",
        &mut warnings,
    )
    .await;
    let banner_path = download_optional(
        client,
        banner_url.as_deref(),
        game_id,
        "banner",
        &mut warnings,
    )
    .await;
    let logo_path =
        download_optional(client, logo_url.as_deref(), game_id, "logo", &mut warnings).await;

    let release_year = info.as_ref().and_then(|meta| meta.release_year);
    let console = info.as_ref().and_then(|meta| meta.console.as_deref());
    let genre = info.as_ref().and_then(|meta| meta.genre.clone());
    let rating = info.as_ref().and_then(|meta| meta.rating);
    let source = info
        .as_ref()
        .map(|meta| meta.source.clone())
        .or_else(|| artwork.as_ref().map(|_| "steamgriddb".to_string()));

    database::apply_game_metadata(
        pool,
        game_id,
        release_year,
        console,
        cover_path.as_deref(),
        banner_path.as_deref(),
        logo_path.as_deref(),
    )
    .await
    .map_err(|e| format!("No se pudo actualizar el juego: {}", e))?;

    let record = MetadataUpsert {
        source: source.as_deref().unwrap_or("steamgriddb"),
        external_id: info.as_ref().and_then(|meta| meta.external_id.as_deref()),
        raw_json: info.as_ref().and_then(|meta| meta.raw_json.as_deref()),
        cover_url: cover_url.as_deref(),
        banner_url: banner_url.as_deref(),
        logo_url: logo_url.as_deref(),
        release_year,
        console,
        developer: info.as_ref().and_then(|meta| meta.developer.as_deref()),
        publisher: info.as_ref().and_then(|meta| meta.publisher.as_deref()),
        genre: genre.as_deref(),
        rating,
    };

    database::upsert_game_metadata(pool, game_id, &record)
        .await
        .map_err(|e| format!("No se pudo guardar la caché de metadatos: {}", e))?;

    Ok(MetadataFetchResult {
        game_id,
        source,
        release_year,
        console: console.map(|value| value.to_string()),
        genre,
        rating,
        cover_path,
        banner_path,
        logo_path,
        warnings,
    })
}


/// Lanza la descarga automática de portadas en segundo plano.
pub fn trigger_background_metadata_fetch(app: AppHandle, pool: sqlx::SqlitePool) {
    let client = metadata::MetadataClient::new(covers_dir(&app));

    tauri::async_runtime::spawn(async move {
        // Obtenemos los juegos sin carátula (hasta 100 de forma continua y gradual)
        let targets = match database::list_games_without_cover(&pool, 100).await {
            Ok(list) => list,
            Err(_) => return,
        };

        if targets.is_empty() {
            return;
        }

        let total = targets.len();
        for (idx, (game_id, name)) in targets.into_iter().enumerate() {
            let outcome = enrich_game(&client, &pool, game_id, &name).await;
            let (cover_path, error) = match outcome {
                Ok(fetched) => (fetched.cover_path, None),
                Err(err) => (None, Some(err)),
            };

            let _ = app.emit(
                METADATA_PROGRESS_EVENT,
                MetadataProgress {
                    processed: idx + 1,
                    total,
                    game_id,
                    name,
                    cover_path,
                    error,
                },
            );

            // Pausa breve para evitar saturar rate limits de las APIs
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
    });
}

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
pub async fn scan_libraries(app: AppHandle, state: State<'_, DbState>) -> Result<ScanResult, String> {
    let outcome = tokio::task::spawn_blocking(scanners::full_scan)
        .await
        .map_err(|e| format!("Error en escaneo: {}", e))?;

    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    let mut result = outcome.result;
    match database::save_games(pool, &outcome.games).await {
        Ok(saved) => {
            result.games_found = saved;
            // Enriquecer automáticamente portadas y metadatos en segundo plano
            trigger_background_metadata_fetch(app, pool.clone());
        }
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
            cover_path: row.cover_path,
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
    app: AppHandle,
    state: State<'_, DbState>,
    game_id: i64,
    source_url_or_path: String,
) -> Result<String, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    let client = metadata::MetadataClient::new(covers_dir(&app));
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

/// Comando: Buscar y descargar metadatos/portada de un juego
#[command]
pub async fn fetch_game_metadata(
    app: AppHandle,
    state: State<'_, DbState>,
    game_id: i64,
) -> Result<MetadataFetchResult, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    let (name, _) = database::game_name_and_cover(pool, game_id)
        .await
        .map_err(|e| format!("Error leyendo el juego: {}", e))?
        .ok_or_else(|| "El juego ya no existe en la biblioteca".to_string())?;

    let client = metadata::MetadataClient::new(covers_dir(&app));
    if !client.is_configured() {
        return Err(
            "Configura las claves de IGDB o SteamGridDB en Ajustes para descargar metadatos."
                .to_string(),
        );
    }

    enrich_game(&client, pool, game_id, &name).await
}

/// Comando: Descargar portadas de los juegos que aún no tienen una
#[command]
pub async fn fetch_missing_covers(
    app: AppHandle,
    state: State<'_, DbState>,
    limit: Option<i64>,
) -> Result<MetadataBulkResult, String> {
    let pool = state
        .pool()
        .await
        .map_err(|e| format!("Error abriendo base de datos: {}", e))?;

    let client = metadata::MetadataClient::new(covers_dir(&app));
    if !client.is_configured() {
        return Err(
            "Configura las claves de IGDB o SteamGridDB en Ajustes para descargar metadatos."
                .to_string(),
        );
    }

    let max = limit.unwrap_or(12).clamp(1, 60);
    let targets = database::list_games_without_cover(pool, max)
        .await
        .map_err(|e| format!("Error leyendo la biblioteca: {}", e))?;

    let mut result = MetadataBulkResult {
        total: targets.len(),
        ..MetadataBulkResult::default()
    };

    for (processed, (game_id, name)) in targets.into_iter().enumerate() {
        let outcome = enrich_game(&client, pool, game_id, &name).await;

        let (cover_path, error) = match outcome {
            Ok(fetched) => {
                result.updated += 1;
                (fetched.cover_path, None)
            }
            Err(err) => {
                result.failed += 1;
                (None, Some(err))
            }
        };

        let _ = app.emit(
            METADATA_PROGRESS_EVENT,
            MetadataProgress {
                processed: processed + 1,
                total: result.total,
                game_id,
                name,
                cover_path,
                error,
            },
        );
    }

    Ok(result)
}

/// Comando: Leer la configuración actual de las APIs de metadatos
#[command]
pub fn get_metadata_settings() -> MetadataSettingsView {
    settings_view()
}

/// Comando: Guardar las claves de IGDB/SteamGridDB
#[command]
pub fn save_metadata_settings(
    app: AppHandle,
    igdb_client_id: Option<String>,
    igdb_client_secret: Option<String>,
    steamgriddb_api_key: Option<String>,
    clear: Option<bool>,
) -> Result<MetadataSettingsView, String> {
    let mut credentials = metadata::load_saved_credentials();

    if clear.unwrap_or(false) {
        credentials = metadata::MetadataCredentials::default();
    } else {
        let assign = |slot: &mut Option<String>, value: Option<String>| {
            if let Some(value) = value {
                let value = value.trim().to_string();
                if !value.is_empty() {
                    *slot = Some(value);
                }
            }
        };

        assign(&mut credentials.igdb_client_id, igdb_client_id);
        assign(&mut credentials.igdb_client_secret, igdb_client_secret);
        assign(&mut credentials.steamgriddb_api_key, steamgriddb_api_key);
    }

    metadata::save_credentials(&credentials)?;

    // Si se acaban de guardar credenciales válidas, iniciar descarga en segundo plano automáticamente
    if credentials.is_configured() {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app_handle.state::<DbState>();
            if let Ok(pool) = state.pool().await {
                trigger_background_metadata_fetch(app_handle.clone(), pool.clone());
            }
        });
    }

    Ok(settings_view())
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

/// Comando: Buscar una nueva versión publicada en GitHub Releases
#[command]
pub async fn check_update() -> Result<updater::UpdateInfo, String> {
    updater::check_for_update().await
}

/// Comando: Descargar e instalar la actualización indicada
#[command]
pub async fn install_update(
    app: AppHandle,
    download_url: String,
    asset_name: String,
    expected_digest: Option<String>,
) -> Result<String, String> {
    updater::download_and_install(app, &download_url, &asset_name, expected_digest.as_deref()).await
}

/// Comando: Activar o desactivar el modo Big Picture (pantalla completa).
/// Devuelve el estado real de la ventana después del cambio.
#[command]
pub fn set_fullscreen(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No se encontró la ventana principal".to_string())?;

    window
        .set_fullscreen(enabled)
        .map_err(|e| format!("No se pudo cambiar el modo de pantalla: {e}"))?;

    window
        .is_fullscreen()
        .map_err(|e| format!("No se pudo leer el estado de la ventana: {e}"))
}

/// Comando: Cambiar el tamaño de la ventana
#[command]
pub fn set_window_size(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No se encontró la ventana principal".to_string())?;

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let scale = monitor.map(|m| m.scale_factor()).unwrap_or(1.0);
    let phys_width = (width as f64 * scale).round() as u32;
    let phys_height = (height as f64 * scale).round() as u32;

    window
        .set_size(tauri::PhysicalSize::new(phys_width, phys_height))
        .map_err(|e| format!("No se pudo redimensionar la ventana: {e}"))?;

    let _ = window.center();
    Ok(())
}
