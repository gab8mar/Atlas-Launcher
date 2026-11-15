//! Cliente de metadatos y arte de portadas.
//!
//! - **IGDB** (vía Twitch) aporta nombre, año, género, plataforma y nota.
//! - **SteamGridDB** aporta carátula vertical, banner y logo.
//!
//! Las credenciales se leen de `%LOCALAPPDATA%\AtlasLauncher\metadata.json`
//! (o de las variables de entorno `ATLAS_IGDB_CLIENT_ID`,
//! `ATLAS_IGDB_CLIENT_SECRET` y `ATLAS_STEAMGRIDDB_API_KEY`).
//! Las imágenes se convierten a WebP y se guardan en la carpeta de datos
//! locales de la aplicación para que el protocolo `asset` pueda servirlas.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

const USER_AGENT: &str = "Atlas-Launcher-Metadata";
const IGDB_TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";
const IGDB_GAMES_URL: &str = "https://api.igdb.com/v4/games";
const STEAMGRIDDB_BASE: &str = "https://www.steamgriddb.com/api/v2";

/// Credenciales de las APIs de metadatos.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct MetadataCredentials {
    #[serde(default)]
    pub igdb_client_id: Option<String>,
    #[serde(default)]
    pub igdb_client_secret: Option<String>,
    #[serde(default)]
    pub steamgriddb_api_key: Option<String>,
}

impl MetadataCredentials {
    pub fn has_igdb(&self) -> bool {
        self.igdb_client_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && self
                .igdb_client_secret
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
    }

    pub fn has_steamgriddb(&self) -> bool {
        self.steamgriddb_api_key
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    }

    pub fn is_configured(&self) -> bool {
        self.has_igdb() || self.has_steamgriddb()
    }
}

/// Datos enriquecidos que devuelve IGDB.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GameMetadata {
    pub external_id: Option<String>,
    pub source: String,
    pub name: String,
    pub release_year: Option<i32>,
    pub console: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub genre: Option<String>,
    pub rating: Option<f64>,
    pub cover_url: Option<String>,
    pub banner_url: Option<String>,
    pub logo_url: Option<String>,
    pub raw_json: Option<String>,
}

/// Arte encontrado en SteamGridDB.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Artwork {
    pub cover_url: Option<String>,
    pub banner_url: Option<String>,
    pub logo_url: Option<String>,
}

/// Carpeta de configuración persistente del launcher.
pub fn config_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(|value| PathBuf::from(value).join("AtlasLauncher"))
        .unwrap_or_else(|_| std::env::temp_dir().join("AtlasLauncher"))
}

fn config_path() -> PathBuf {
    config_dir().join("metadata.json")
}

/// Carga las credenciales guardadas en disco (sin variables de entorno).
pub fn load_saved_credentials() -> MetadataCredentials {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<MetadataCredentials>(&raw).ok())
        .unwrap_or_default()
}

/// Carga las credenciales guardadas, dando prioridad a las variables de entorno.
pub fn load_credentials() -> MetadataCredentials {
    let mut credentials = load_saved_credentials();

    if let Ok(value) = std::env::var("ATLAS_IGDB_CLIENT_ID") {
        if !value.trim().is_empty() {
            credentials.igdb_client_id = Some(value);
        }
    }
    if let Ok(value) = std::env::var("ATLAS_IGDB_CLIENT_SECRET") {
        if !value.trim().is_empty() {
            credentials.igdb_client_secret = Some(value);
        }
    }
    if let Ok(value) = std::env::var("ATLAS_STEAMGRIDDB_API_KEY") {
        if !value.trim().is_empty() {
            credentials.steamgriddb_api_key = Some(value);
        }
    }

    credentials
}

/// Guarda las credenciales en disco (permisos del usuario actual).
pub fn save_credentials(credentials: &MetadataCredentials) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear la carpeta de configuración: {}", e))?;
    }

    let json = serde_json::to_string_pretty(credentials)
        .map_err(|e| format!("No se pudieron serializar las credenciales: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("No se pudieron guardar las credenciales: {}", e))
}

/// Codifica un segmento de URL (evita depender de otra crate).
fn encode_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        let allowed = byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'_' | b'.' | b'~');
        if allowed {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

/// Convierte una URL de IGDB (`//images.../t_thumb/...`) en una portada grande.
fn normalize_igdb_cover(game: &IgdbGame) -> Option<String> {
    if let Some(cover) = &game.cover {
        if let Some(image_id) = &cover.image_id {
            return Some(format!(
                "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/{}.jpg",
                image_id
            ));
        }
        if let Some(url) = &cover.url {
            let url = url.trim_start_matches("//");
            let upgraded = url
                .replace("/t_thumb/", "/t_cover_big_2x/")
                .replace("/t_cover_small/", "/t_cover_big_2x/");
            return Some(format!("https://{}", upgraded));
        }
    }
    None
}

/// Cliente con conexión HTTP reutilizable y caché del token de Twitch.
pub struct MetadataClient {
    client: reqwest::Client,
    credentials: MetadataCredentials,
    cache_dir: PathBuf,
    igdb_token: tokio::sync::Mutex<Option<(String, SystemTime)>>,
}

impl MetadataClient {
    pub fn new(cache_dir: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(25))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            credentials: load_credentials(),
            cache_dir,
            igdb_token: tokio::sync::Mutex::new(None),
        }
    }

    pub fn has_igdb(&self) -> bool {
        self.credentials.has_igdb()
    }

    pub fn has_steamgriddb(&self) -> bool {
        self.credentials.has_steamgriddb()
    }

    pub fn is_configured(&self) -> bool {
        self.credentials.is_configured()
    }

    /// Obtiene (y cachea) un token de Twitch para IGDB.
    async fn igdb_token(&self) -> Result<String, String> {
        {
            let cached = self.igdb_token.lock().await;
            if let Some((token, expires_at)) = cached.as_ref() {
                if SystemTime::now() < *expires_at {
                    return Ok(token.clone());
                }
            }
        }

        let client_id = self
            .credentials
            .igdb_client_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Falta el Client ID de IGDB".to_string())?;
        let client_secret = self
            .credentials
            .igdb_client_secret
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Falta el Client Secret de IGDB".to_string())?;

        let response = self
            .client
            .post(IGDB_TOKEN_URL)
            .query(&[
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("grant_type", "client_credentials"),
            ])
            .send()
            .await
            .map_err(|e| format!("No se pudo conectar con Twitch/IGDB: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "IGDB rechazó las credenciales (HTTP {})",
                response.status().as_u16()
            ));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            #[serde(default)]
            expires_in: u64,
        }

        let body: TokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Respuesta inválida de Twitch: {}", e))?;

        let lifetime = if body.expires_in > 120 {
            body.expires_in - 60
        } else {
            300
        };
        let expires_at = SystemTime::now() + Duration::from_secs(lifetime);

        let mut cached = self.igdb_token.lock().await;
        *cached = Some((body.access_token.clone(), expires_at));

        Ok(body.access_token)
    }

    /// Busca un juego en IGDB y devuelve sus metadatos.
    pub async fn search_igdb(&self, query: &str) -> Result<Option<GameMetadata>, String> {
        if !self.has_igdb() || query.trim().is_empty() {
            return Ok(None);
        }

        let token = self.igdb_token().await?;
        let client_id = self.credentials.igdb_client_id.clone().unwrap_or_default();

        let escaped = query.replace('\\', "\\\\").replace('"', "\\\"");
        let body = format!(
            "search \"{}\"; fields name,first_release_date,cover.url,cover.image_id,genres.name,platforms.name,total_rating; limit 3;",
            escaped
        );

        let response = self
            .client
            .post(IGDB_GAMES_URL)
            .header("Client-ID", client_id)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| format!("No se pudo consultar IGDB: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "IGDB respondió HTTP {}",
                response.status().as_u16()
            ));
        }

        let raw_json = response
            .text()
            .await
            .map_err(|e| format!("No se pudo leer la respuesta de IGDB: {}", e))?;

        let games: Vec<IgdbGame> = serde_json::from_str(&raw_json)
            .map_err(|e| format!("Respuesta de IGDB inválida: {}", e))?;

        let Some(game) = games.into_iter().next() else {
            return Ok(None);
        };

        let release_year = game.first_release_date.and_then(|timestamp| {
            chrono::DateTime::from_timestamp(timestamp, 0)
                .map(|date| chrono::Datelike::year(&date))
        });
        let cover_url = normalize_igdb_cover(&game);
        let console = game.platforms.first().map(|platform| platform.name.clone());
        let genre = game.genres.first().map(|genre| genre.name.clone());

        Ok(Some(GameMetadata {
            external_id: Some(game.id.to_string()),
            source: "igdb".to_string(),
            name: game.name,
            release_year,
            console,
            developer: None,
            publisher: None,
            genre,
            rating: game.total_rating,
            cover_url,
            banner_url: None,
            logo_url: None,
            raw_json: Some(raw_json),
        }))
    }

    /// Busca carátula, banner y logo en SteamGridDB.
    pub async fn search_steamgriddb(&self, game_name: &str) -> Result<Option<Artwork>, String> {
        if !self.has_steamgriddb() || game_name.trim().is_empty() {
            return Ok(None);
        }

        let api_key = self
            .credentials
            .steamgriddb_api_key
            .clone()
            .unwrap_or_default();

        let search_url = format!(
            "{}/search/autocomplete/{}",
            STEAMGRIDDB_BASE,
            encode_segment(game_name)
        );
        let results: SgdbResponse<SgdbGame> = self.sgdb_get(&search_url, &api_key).await?;

        let candidates = results.data.unwrap_or_default();
        let wanted = game_name.trim();
        let game = candidates
            .iter()
            .find(|candidate| {
                candidate
                    .name
                    .as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case(wanted))
            })
            .or_else(|| candidates.first());

        let Some(game) = game else {
            return Ok(None);
        };

        let grids_url = format!(
            "{}/grids/game/{}?dimensions=600x900&types=static",
            STEAMGRIDDB_BASE, game.id
        );
        let cover_url = match self
            .sgdb_get::<SgdbAsset>(&grids_url, &api_key)
            .await
        {
            Ok(response) => response
                .data
                .and_then(|items| items.into_iter().next())
                .map(|asset| asset.url),
            Err(_) => None,
        };

        let heroes_url = format!(
            "{}/heroes/game/{}?dimensions=1920x620&types=static",
            STEAMGRIDDB_BASE, game.id
        );
        let banner_url = self
            .sgdb_get::<SgdbAsset>(&heroes_url, &api_key)
            .await
            .ok()
            .and_then(|response| response.data)
            .and_then(|items| items.into_iter().next())
            .map(|asset| asset.url);

        let logos_url = format!(
            "{}/logos/game/{}?types=static",
            STEAMGRIDDB_BASE, game.id
        );
        let logo_url = self
            .sgdb_get::<SgdbAsset>(&logos_url, &api_key)
            .await
            .ok()
            .and_then(|response| response.data)
            .and_then(|items| items.into_iter().next())
            .map(|asset| asset.url);

        if cover_url.is_none() && banner_url.is_none() && logo_url.is_none() {
            return Ok(None);
        }

        Ok(Some(Artwork {
            cover_url,
            banner_url,
            logo_url,
        }))
    }

    async fn sgdb_get<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        api_key: &str,
    ) -> Result<SgdbResponse<T>, String> {
        let response = self
            .client
            .get(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("No se pudo consultar SteamGridDB: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "SteamGridDB respondió HTTP {}",
                response.status().as_u16()
            ));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Respuesta de SteamGridDB inválida: {}", e))
    }

    /// Descarga una imagen y la convierte a WebP dentro de la caché de portadas.
    pub async fn download_art(
        &self,
        url: &str,
        game_id: i64,
        kind: &str,
    ) -> Result<PathBuf, String> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("No se pudo descargar la imagen: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "La descarga de la imagen falló (HTTP {})",
                response.status().as_u16()
            ));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("No se pudo leer la imagen: {}", e))?;

        std::fs::create_dir_all(&self.cache_dir)
            .map_err(|e| format!("No se pudo crear la carpeta de portadas: {}", e))?;

        let safe_kind: String = kind
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        let safe_kind = if safe_kind.is_empty() {
            "cover".to_string()
        } else {
            safe_kind
        };
        let file_path = self.cache_dir.join(format!("{}-{}.webp", game_id, safe_kind));

        write_webp(&bytes, &file_path)?;

        Ok(file_path)
    }

    /// Descarga una carátula (alias mantenido para el comando manual).
    pub async fn download_cover(
        &self,
        url: &str,
        game_id: i64,
    ) -> Result<PathBuf, String> {
        self.download_art(url, game_id, "cover").await
    }
}

/// Convierte los bytes de una imagen (PNG/JPEG/WebP) a WebP sin pérdida.
fn write_webp(bytes: &[u8], file_path: &std::path::Path) -> Result<(), String> {
    use std::io::Write;

    let image = image::load_from_memory(bytes)
        .map_err(|e| format!("La imagen descargada no es válida: {}", e))?;
    let rgba = image.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());

    let file = std::fs::File::create(file_path)
        .map_err(|e| format!("No se pudo crear el archivo de portada: {}", e))?;
    let mut writer = std::io::BufWriter::new(file);
    image::codecs::webp::WebPEncoder::new_lossless(&mut writer)
        .encode(rgba.as_raw(), width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("No se pudo convertir la imagen a WebP: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("No se pudo escribir la portada en disco: {}", e))?;

    Ok(())
}

#[derive(Debug, Deserialize)]
struct IgdbGame {
    id: i64,
    name: String,
    #[serde(default)]
    first_release_date: Option<i64>,
    #[serde(default)]
    cover: Option<IgdbCover>,
    #[serde(default)]
    genres: Vec<IgdbNamed>,
    #[serde(default)]
    platforms: Vec<IgdbNamed>,
    #[serde(default)]
    total_rating: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct IgdbCover {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    image_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbNamed {
    name: String,
}

#[derive(Debug, Deserialize)]
struct SgdbResponse<T> {
    data: Option<Vec<T>>,
}

#[derive(Debug, Deserialize)]
struct SgdbGame {
    id: i64,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SgdbAsset {
    url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_detection() {
        let mut credentials = MetadataCredentials::default();
        assert!(!credentials.is_configured());

        credentials.steamgriddb_api_key = Some("abc".to_string());
        assert!(credentials.is_configured());
        assert!(credentials.has_steamgriddb());
        assert!(!credentials.has_igdb());

        credentials.igdb_client_id = Some("id".to_string());
        credentials.igdb_client_secret = Some("secret".to_string());
        assert!(credentials.has_igdb());
    }

    #[test]
    fn encodes_search_segments() {
        assert_eq!(encode_segment("Half-Life 2"), "Half-Life%202");
        assert_eq!(encode_segment("Pokémon"), "Pok%C3%A9mon");
    }

    #[test]
    fn writes_lossless_webp() {
        use image::ImageEncoder;

        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&[255, 0, 0], 1, 1, image::ExtendedColorType::Rgb8)
            .expect("PNG de prueba");

        let path = std::env::temp_dir().join(format!(
            "atlas-launcher-webp-test-{}.webp",
            std::process::id()
        ));
        write_webp(&png, &path).expect("Conversión a WebP");

        let bytes = std::fs::read(&path).expect("Leer WebP");
        assert!(bytes.len() > 12);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WEBP");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn normalizes_igdb_cover() {
        let image_id = IgdbGame {
            id: 1,
            name: "X".to_string(),
            first_release_date: None,
            cover: Some(IgdbCover {
                url: None,
                image_id: Some("abc123".to_string()),
            }),
            genres: Vec::new(),
            platforms: Vec::new(),
            total_rating: None,
        };
        assert_eq!(
            normalize_igdb_cover(&image_id),
            Some("https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc123.jpg".to_string())
        );

        let with_url = IgdbGame {
            cover: Some(IgdbCover {
                url: Some("//images.igdb.com/igdb/image/upload/t_thumb/abc.jpg".to_string()),
                image_id: None,
            }),
            ..image_id
        };
        assert_eq!(
            normalize_igdb_cover(&with_url),
            Some("https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc.jpg".to_string())
        );
    }
}
