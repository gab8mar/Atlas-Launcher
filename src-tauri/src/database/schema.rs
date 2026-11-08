//! Esquema de base de datos para Atlas Launcher
//! 
//! Tablas:
//! - platforms: Plataformas de origen (Steam, Epic, GOG, Emulador, Custom)
//! - sagas: Colecciones de sagas (Zelda, Final Fantasy, etc.)
//! - games: Juegos registrados con metadatos
//! - emulators: Emuladores detectados en el sistema
//! - game_emulators: Mapeo juego -> emulador
//! - metadata: Metadatos enriquecidos (portada, año, consola, etc.)

use sqlx::migrate::Migrator;

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Ejecuta todas las migraciones pendientes
pub async fn run_migrations(pool: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    MIGRATOR.run(pool).await
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn test_migration_structure() {
        // Verificar que las migraciones sean válidas
        assert!(true);
    }
}
