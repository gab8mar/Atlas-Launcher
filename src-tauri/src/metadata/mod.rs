use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
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

#[derive(Debug, Serialize, Deserialize)]
pub struct CoverResult {
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub format: String,
}

pub struct MetadataClient {
    client: Client,
    igdb_client_id: Option<String>,
    igdb_client_secret: Option<String>,
    steamgriddb_api_key: Option<String>,
    cache_dir: PathBuf,
}

impl MetadataClient {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            client: Client::new(),
            igdb_client_id: None,
            igdb_client_secret: None,
            steamgriddb_api_key: None,
            cache_dir,
        }
    }
    
    pub fn with_igdb_credentials(mut self, client_id: String, client_secret: String) -> Self {
        self.igdb_client_id = Some(client_id);
        self.igdb_client_secret = Some(client_secret);
        self
    }
    
    pub fn with_steamgriddb_key(mut self, api_key: String) -> Self {
        self.steamgriddb_api_key = Some(api_key);
        self
    }
    
    pub async fn search_igdb(&self, _query: &str) -> Result<Option<GameMetadata>, Box<dyn std::error::Error>> {
        if self.igdb_client_id.is_none() {
            return Ok(None);
        }
        Ok(None)
    }
    
    pub async fn search_steamgriddb_cover(&self, _game_name: &str) -> Result<Option<CoverResult>, Box<dyn std::error::Error>> {
        if self.steamgriddb_api_key.is_none() {
            return Ok(None);
        }
        Ok(None)
    }
    
    pub async fn download_cover(&self, url: &str, game_id: i64) -> Result<PathBuf, Box<dyn std::error::Error>> {
        let response = self.client.get(url).send().await?;
        let bytes = response.bytes().await?;
        
        let cover_dir = self.cache_dir.join("covers");
        std::fs::create_dir_all(&cover_dir)?;
        
        let file_path = cover_dir.join(format!("{}.webp", game_id));
        std::fs::write(&file_path, &bytes)?;
        
        Ok(file_path)
    }
}

impl Default for MetadataClient {
    fn default() -> Self {
        Self::new(std::env::temp_dir().join("atlas-launcher").join("cache"))
    }
}
