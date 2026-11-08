use std::path::PathBuf;
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use tokio::sync::OnceCell;

use crate::scanners::DetectedGame;

/// Ruta de la base de datos SQLite
pub fn db_path() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(|v| PathBuf::from(v).join("AtlasLauncher"))
        .unwrap_or_else(|_| std::env::temp_dir().join("AtlasLauncher"));

    let _ = std::fs::create_dir_all(&base);
    base.join("atlas.db")
}

/// Estado compartido de la base de datos.
/// La conexión se crea una sola vez (lazy) y se reutiliza en todos los comandos.
pub struct DbState {
    pool: OnceCell<SqlitePool>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            pool: OnceCell::new(),
        }
    }

    pub async fn pool(&self) -> Result<&SqlitePool, sqlx::Error> {
        self.pool.get_or_try_init(init_pool).await
    }
}

impl Default for DbState {
    fn default() -> Self {
        Self::new()
    }
}

async fn init_pool() -> Result<SqlitePool, sqlx::Error> {
    let path = db_path();
    tracing::info!("Ruta de la base de datos: {}", path.display());

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // SqliteConnectOptions maneja correctamente rutas de Windows (C:\...).
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    create_schema(&pool).await?;
    tracing::info!("Base de datos inicializada correctamente");
    Ok(pool)
}

/// Crea el esquema y los datos iniciales.
async fn create_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS platforms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            accent_color TEXT NOT NULL DEFAULT '#ffffff',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sagas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            display_name TEXT,
            saga_id INTEGER REFERENCES sagas(id),
            platform_id INTEGER REFERENCES platforms(id),
            executable_path TEXT NOT NULL DEFAULT '',
            arguments TEXT,
            working_directory TEXT,
            is_emulated BOOLEAN DEFAULT 0,
            rom_iso_path TEXT,
            cover_path TEXT,
            banner_path TEXT,
            logo_path TEXT,
            release_year INTEGER,
            console TEXT,
            play_time_minutes INTEGER DEFAULT 0,
            last_played DATETIME,
            installed BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS emulators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            executable_path TEXT NOT NULL DEFAULT '',
            supported_extensions TEXT NOT NULL DEFAULT '.iso,.rom,.bin,.cue,.nsp,.xci',
            default_arguments TEXT,
            is_verified BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS game_emulators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            emulator_id INTEGER NOT NULL REFERENCES emulators(id) ON DELETE CASCADE,
            launch_arguments TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(game_id, emulator_id)
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            source TEXT NOT NULL DEFAULT 'manual',
            external_id TEXT,
            raw_json TEXT,
            cover_url TEXT,
            banner_url TEXT,
            logo_url TEXT,
            release_year INTEGER,
            console TEXT,
            developer TEXT,
            publisher TEXT,
            genre TEXT,
            rating REAL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(game_id, source)
        );
        "#,
    )
    .execute(pool)
    .await?;

    // Índices para búsquedas rápidas
    for stmt in [
        "CREATE INDEX IF NOT EXISTS idx_games_saga_id ON games(saga_id)",
        "CREATE INDEX IF NOT EXISTS idx_games_platform_id ON games(platform_id)",
        "CREATE INDEX IF NOT EXISTS idx_games_name ON games(name)",
        "CREATE INDEX IF NOT EXISTS idx_games_is_emulated ON games(is_emulated)",
        "CREATE INDEX IF NOT EXISTS idx_games_installed ON games(installed)",
        "CREATE INDEX IF NOT EXISTS idx_games_release_year ON games(release_year)",
        "CREATE INDEX IF NOT EXISTS idx_metadata_game_id ON metadata(game_id)",
        "CREATE INDEX IF NOT EXISTS idx_game_emulators_game_id ON game_emulators(game_id)",
    ] {
        sqlx::query(stmt).execute(pool).await?;
    }

    // Plataformas iniciales
    for (name, display, color) in [
        ("steam", "Steam", "#0a98fc"),
        ("epic", "Epic Games Store", "#5f128d"),
        ("gog", "GOG", "#ff4500"),
        ("emulator", "Emulador", "#00ff88"),
        ("custom", "Personalizado", "#ffcc00"),
    ] {
        sqlx::query(
            "INSERT OR IGNORE INTO platforms (name, display_name, accent_color) VALUES (?1, ?2, ?3)",
        )
        .bind(name)
        .bind(display)
        .bind(color)
        .execute(pool)
        .await?;
    }

    // Emuladores conocidos (se completan cuando se detectan instalados)
    for (name, ext) in [
        ("Dolphin", ".iso,.gcm,.wbfs,.ciso,.nkit"),
        ("RetroArch", ".nes,.snes,.gb,.gba,.nds,.pce,.md,.gen,.smd,.iso,.bin,.cue"),
        ("Ryujinx", ".nsp,.xci,.nsz,.xcz"),
        ("mGBA", ".gba,.gbc"),
        ("DOSBox", ".exe,.conf,.bat"),
        ("PCSX2", ".iso,.bin,.cue,.img,.mdf"),
        ("RPCS3", ".pkg,.iso,.iso.ps3"),
    ] {
        sqlx::query("INSERT OR IGNORE INTO emulators (name, supported_extensions) VALUES (?1, ?2)")
            .bind(name)
            .bind(ext)
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Fila de juego lista para el frontend.
#[derive(Debug, Clone, Serialize)]
pub struct GameRow {
    pub id: i64,
    pub name: String,
    pub saga: Option<String>,
    pub release_year: Option<i32>,
    pub console: Option<String>,
    pub cover_path: Option<String>,
    pub platform: String,
    pub executable_path: String,
    pub arguments: Option<String>,
    pub rom_iso_path: Option<String>,
    pub is_emulated: bool,
    pub play_time_minutes: i64,
    pub last_played: Option<String>,
}

/// Guarda los juegos detectados. Los que ya no aparecen quedan como no instalados.
pub async fn save_games(pool: &SqlitePool, games: &[DetectedGame]) -> Result<usize, sqlx::Error> {
    sqlx::query("UPDATE games SET installed = 0").execute(pool).await?;

    let mut saved = 0usize;

    for game in games {
        let platform_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM platforms WHERE name = ?1")
                .bind(&game.platform)
                .fetch_optional(pool)
                .await?;

        let saga_id: Option<i64> = match &game.saga {
            Some(name) => {
                sqlx::query("INSERT OR IGNORE INTO sagas (name) VALUES (?1)")
                    .bind(name)
                    .execute(pool)
                    .await?;
                sqlx::query_scalar("SELECT id FROM sagas WHERE name = ?1")
                    .bind(name)
                    .fetch_optional(pool)
                    .await?
            }
            None => None,
        };

        let identity = game
            .executable_path
            .as_deref()
            .or(game.rom_iso_path.as_deref())
            .unwrap_or("");
        let uuid_source = format!("{}|{}|{}", game.platform, game.name, identity);
        let uuid = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, uuid_source.as_bytes()).to_string();

        let executable = game.executable_path.clone().unwrap_or_default();

        sqlx::query(
            r#"
            INSERT INTO games (
                uuid, name, saga_id, platform_id, executable_path, rom_iso_path,
                is_emulated, console, release_year, installed, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(uuid) DO UPDATE SET
                name = excluded.name,
                saga_id = excluded.saga_id,
                platform_id = excluded.platform_id,
                executable_path = excluded.executable_path,
                rom_iso_path = excluded.rom_iso_path,
                is_emulated = excluded.is_emulated,
                console = excluded.console,
                release_year = excluded.release_year,
                installed = 1,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&uuid)
        .bind(&game.name)
        .bind(saga_id)
        .bind(platform_id)
        .bind(&executable)
        .bind(game.rom_iso_path.as_deref())
        .bind(game.rom_iso_path.is_some())
        .bind(&game.console)
        .bind(game.release_year)
        .execute(pool)
        .await?;

        saved += 1;
    }

    Ok(saved)
}

/// Devuelve todos los juegos instalados.
pub async fn list_games(pool: &SqlitePool) -> Result<Vec<GameRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT
            g.id,
            g.name,
            s.name AS saga,
            g.release_year,
            g.console,
            g.cover_path,
            COALESCE(p.name, 'custom') AS platform,
            g.executable_path,
            g.arguments,
            g.rom_iso_path,
            g.is_emulated,
            COALESCE(g.play_time_minutes, 0) AS play_time_minutes,
            g.last_played
        FROM games g
        LEFT JOIN sagas s ON s.id = g.saga_id
        LEFT JOIN platforms p ON p.id = g.platform_id
        WHERE g.installed = 1
        ORDER BY g.name COLLATE NOCASE
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut games = Vec::with_capacity(rows.len());
    for row in rows {
        games.push(GameRow {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            saga: row.try_get("saga")?,
            release_year: row.try_get("release_year")?,
            console: row.try_get("console")?,
            cover_path: row.try_get("cover_path")?,
            platform: row.try_get("platform")?,
            executable_path: row.try_get("executable_path")?,
            arguments: row.try_get("arguments")?,
            rom_iso_path: row.try_get("rom_iso_path")?,
            is_emulated: row.try_get::<i64, _>("is_emulated")? != 0,
            play_time_minutes: row.try_get("play_time_minutes")?,
            last_played: row.try_get("last_played")?,
        });
    }

    Ok(games)
}

/// Actualiza manualmente un juego existente
pub async fn update_game(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    saga: Option<&str>,
    release_year: Option<i32>,
    console: Option<&str>,
    executable_path: &str,
    arguments: Option<&str>,
    cover_path: Option<&str>,
) -> Result<(), sqlx::Error> {
    let saga_id: Option<i64> = match saga {
        Some(s) if !s.trim().is_empty() => {
            sqlx::query("INSERT OR IGNORE INTO sagas (name) VALUES (?1)")
                .bind(s.trim())
                .execute(pool)
                .await?;
            sqlx::query_scalar("SELECT id FROM sagas WHERE name = ?1")
                .bind(s.trim())
                .fetch_optional(pool)
                .await?
        }
        _ => None,
    };

    sqlx::query(
        r#"
        UPDATE games
        SET name = ?1,
            saga_id = ?2,
            release_year = ?3,
            console = ?4,
            executable_path = ?5,
            arguments = ?6,
            cover_path = ?7,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?8
        "#,
    )
    .bind(name)
    .bind(saga_id)
    .bind(release_year)
    .bind(console)
    .bind(executable_path)
    .bind(arguments)
    .bind(cover_path)
    .bind(id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Añade un juego de forma manual
pub async fn add_custom_game(
    pool: &SqlitePool,
    name: &str,
    platform: &str,
    executable_path: &str,
    arguments: Option<&str>,
    saga: Option<&str>,
    console: Option<&str>,
    release_year: Option<i32>,
    cover_path: Option<&str>,
) -> Result<i64, sqlx::Error> {
    let platform_id: Option<i64> =
        sqlx::query_scalar("SELECT id FROM platforms WHERE name = ?1")
            .bind(platform)
            .fetch_optional(pool)
            .await?;

    let saga_id: Option<i64> = match saga {
        Some(s) if !s.trim().is_empty() => {
            sqlx::query("INSERT OR IGNORE INTO sagas (name) VALUES (?1)")
                .bind(s.trim())
                .execute(pool)
                .await?;
            sqlx::query_scalar("SELECT id FROM sagas WHERE name = ?1")
                .bind(s.trim())
                .fetch_optional(pool)
                .await?
        }
        _ => None,
    };

    let uuid_source = format!("custom|{}|{}", name, executable_path);
    let uuid = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, uuid_source.as_bytes()).to_string();

    let id = sqlx::query(
        r#"
        INSERT INTO games (
            uuid, name, saga_id, platform_id, executable_path, arguments,
            is_emulated, console, release_year, cover_path, installed, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, 1, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(&uuid)
    .bind(name)
    .bind(saga_id)
    .bind(platform_id)
    .bind(executable_path)
    .bind(arguments)
    .bind(console)
    .bind(release_year)
    .bind(cover_path)
    .execute(pool)
    .await?
    .last_insert_rowid();

    Ok(id)
}

/// Registra tiempo de sesión jugado
pub async fn record_playtime(
    pool: &SqlitePool,
    game_id: i64,
    minutes_played: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE games
        SET play_time_minutes = COALESCE(play_time_minutes, 0) + ?1,
            last_played = CURRENT_TIMESTAMP
        WHERE id = ?2
        "#,
    )
    .bind(minutes_played)
    .bind(game_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Elimina o desinstala un juego de la biblioteca
pub async fn delete_game(pool: &SqlitePool, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM games WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Inicializa la base de datos (idempotente).
pub async fn init(state: &DbState) -> Result<(), sqlx::Error> {
    state.pool().await.map(|_| ())
}
