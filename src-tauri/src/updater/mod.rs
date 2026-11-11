//! Actualizaciones automáticas desde GitHub Releases.
//!
//! Consulta el último release publicado en el repositorio oficial, compara la
//! versión con la de la aplicación y, si hay una nueva, descarga el instalador
//! (NSIS o MSI) para ejecutarlo.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

/// Repositorio oficial de GitHub del que se descargan las actualizaciones.
const GITHUB_REPO: &str = "gab8mar/Atlas-Launcher";
const USER_AGENT: &str = "Atlas-Launcher-Updater";
const UPDATE_PROGRESS_EVENT: &str = "atlas-update-progress";

/// Información de una actualización disponible.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_name: Option<String>,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub html_url: Option<String>,
    pub asset_name: Option<String>,
    pub download_url: Option<String>,
    pub asset_size: Option<u64>,
    pub digest: Option<String>,
}

/// Progreso de la descarga enviado al frontend.
#[derive(Debug, Clone, Serialize)]
struct UpdateProgress {
    downloaded: u64,
    total: u64,
    percent: f64,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
    /// Formato `sha256:<hex>` que GitHub calcula para cada asset.
    #[serde(default)]
    digest: Option<String>,
}

/// Versión actual de la aplicación, tomada de `Cargo.toml`.
pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Compara dos versiones semánticas y determina si `latest` es más nueva.
fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        value
            .trim()
            .trim_start_matches(|c| c == 'v' || c == 'V')
            .split(|c: char| !c.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<u64>().ok())
            .collect()
    };

    let latest_parts = parse(latest);
    let current_parts = parse(current);

    if latest_parts.is_empty() {
        return false;
    }

    let len = latest_parts.len().max(current_parts.len());
    for index in 0..len {
        let new_part = latest_parts.get(index).copied().unwrap_or(0);
        let old_part = current_parts.get(index).copied().unwrap_or(0);
        if new_part != old_part {
            return new_part > old_part;
        }
    }

    false
}

/// Elige el instalador más adecuado de entre los assets del release.
///
/// Si la aplicación está instalada en `Program Files` (instalación por
/// máquina, típicamente MSI) se prefiere el `.msi`; en caso contrario se usa
/// el instalador NSIS, que instala por usuario.
fn select_installer(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    let is_installer = |asset: &GithubAsset| {
        let name = asset.name.to_lowercase();
        name.ends_with(".exe") || name.ends_with(".msi")
    };

    let candidates: Vec<&GithubAsset> = assets.iter().filter(|asset| is_installer(asset)).collect();

    let nsis = candidates
        .iter()
        .find(|asset| asset.name.to_lowercase().ends_with("-setup.exe"))
        .or_else(|| {
            candidates
                .iter()
                .find(|asset| asset.name.to_lowercase().ends_with(".exe"))
        })
        .copied();

    let msi = candidates
        .iter()
        .find(|asset| asset.name.to_lowercase().ends_with(".msi"))
        .copied();

    if is_per_machine_install() {
        msi.or(nsis)
    } else {
        nsis.or(msi)
    }
}

/// Detecta si la aplicación se instaló en `Program Files`.
fn is_per_machine_install() -> bool {
    let exe = match std::env::current_exe() {
        Ok(path) => path.to_string_lossy().to_lowercase(),
        Err(_) => return false,
    };

    ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|variable| std::env::var(variable).ok())
        .filter(|path| !path.is_empty())
        .any(|path| exe.starts_with(&path.to_lowercase()))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("No se pudo crear el cliente HTTP: {}", e))
}

/// Consulta el último release publicado y compara versiones.
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current = current_version();
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let client = http_client()?;
    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("No se pudo contactar con GitHub: {}", e))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        // Todavía no hay ningún release publicado.
        return Ok(UpdateInfo {
            available: false,
            current_version: current.clone(),
            latest_version: current,
            release_name: None,
            release_notes: None,
            published_at: None,
            html_url: None,
            asset_name: None,
            download_url: None,
            asset_size: None,
            digest: None,
        });
    }

    if !response.status().is_success() {
        return Err(format!(
            "GitHub respondió con un error ({}). Inténtalo de nuevo más tarde.",
            response.status()
        ));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("Respuesta inválida de GitHub: {}", e))?;

    let latest = release
        .tag_name
        .trim_start_matches(|c| c == 'v' || c == 'V')
        .to_string();
    let available = is_newer_version(&latest, &current);
    let installer = select_installer(&release.assets);

    Ok(UpdateInfo {
        available,
        current_version: current,
        latest_version: latest,
        release_name: release.name,
        release_notes: release.body,
        published_at: release.published_at,
        html_url: release.html_url,
        asset_name: installer.map(|asset| asset.name.clone()),
        download_url: installer.map(|asset| asset.browser_download_url.clone()),
        asset_size: installer.map(|asset| asset.size),
        digest: installer.and_then(|asset| asset.digest.clone()),
    })
}

/// Descarga el instalador, verifica su integridad y lo ejecuta.
pub async fn download_and_install(
    app: AppHandle,
    download_url: &str,
    asset_name: &str,
    expected_digest: Option<&str>,
) -> Result<String, String> {
    let safe_name = asset_name
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("atlas-launcher-update.exe");

    let destination = std::env::temp_dir().join(format!("atlas-update-{}", safe_name));

    let client = http_client()?;
    let mut response = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar la actualización: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "La descarga falló con el estado {}.",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut hasher = Sha256::new();
    let mut file = tokio::fs::File::create(&destination)
        .await
        .map_err(|e| format!("No se pudo crear el archivo temporal: {}", e))?;

    use tokio::io::AsyncWriteExt;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Error recibiendo la actualización: {}", e))?
    {
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("No se pudo escribir la actualización: {}", e))?;
        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0).min(100.0)
        } else {
            0.0
        };
        let _ = app.emit(
            UPDATE_PROGRESS_EVENT,
            UpdateProgress {
                downloaded,
                total,
                percent,
            },
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("No se pudo finalizar la descarga: {}", e))?;
    drop(file);

    if let Some(digest) = expected_digest {
        if let Some(expected) = digest.trim().strip_prefix("sha256:") {
            let actual = format!("{:x}", hasher.finalize());
            if !actual.eq_ignore_ascii_case(expected) {
                let _ = tokio::fs::remove_file(&destination).await;
                return Err(
                    "La actualización descargada está corrupta (checksum inválido).".to_string(),
                );
            }
        }
    }

    let _ = app.emit(
        UPDATE_PROGRESS_EVENT,
        UpdateProgress {
            downloaded,
            total: if total > 0 { total } else { downloaded },
            percent: 100.0,
        },
    );

    launch_installer(&destination)?;

    // Cerramos la aplicación para que el instalador pueda reemplazar los
    // archivos sin conflictos. El proceso del instalador sigue vivo.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(800)).await;
        handle.exit(0);
    });

    Ok("Actualización descargada. El instalador se abrirá en un momento.".to_string())
}

fn launch_installer(path: &PathBuf) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase();

    let mut command = if extension == "msi" {
        let mut cmd = Command::new("msiexec");
        cmd.arg("/i").arg(path);
        cmd
    } else {
        Command::new(path)
    };

    command
        .spawn()
        .map_err(|e| format!("No se pudo iniciar el instalador: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_newer_version;

    #[test]
    fn detects_newer_versions() {
        assert!(is_newer_version("1.2.0", "1.1.9"));
        assert!(is_newer_version("v2.0.0", "1.99.99"));
        assert!(!is_newer_version("1.0.0", "1.0.0"));
        assert!(!is_newer_version("0.9.0", "1.0.0"));
    }
}
