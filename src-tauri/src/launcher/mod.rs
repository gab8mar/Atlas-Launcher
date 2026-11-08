use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LaunchResult {
    pub success: bool,
    pub game_id: Option<i64>,
    pub message: String,
    pub process_id: Option<u32>,
}

pub struct LauncherManager;

impl LauncherManager {
    pub fn new() -> Self {
        Self
    }

    /// Lanza un ejecutable nativo con argumentos opcionales.
    pub async fn launch_native(
        &self,
        executable: &str,
        arguments: Option<&str>,
        working_dir: Option<&str>,
    ) -> Result<LaunchResult, String> {
        let executable = executable.to_string();
        let arguments = arguments.map(|s| s.to_string());
        let working_dir = working_dir.map(|s| s.to_string());

        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&executable);

            if let Some(args) = &arguments {
                cmd.args(args.split_whitespace());
            }
            if let Some(dir) = &working_dir {
                cmd.current_dir(dir);
            }

            match cmd.spawn() {
                Ok(child) => {
                    let pid = child.id();
                    std::mem::forget(child);
                    Ok(LaunchResult {
                        success: true,
                        game_id: None,
                        message: format!("Lanzado: {}", executable),
                        process_id: Some(pid),
                    })
                }
                Err(e) => Ok(LaunchResult {
                    success: false,
                    game_id: None,
                    message: format!("No se pudo lanzar '{}': {}", executable, e),
                    process_id: None,
                }),
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Lanza una ROM/ISO con un emulador.
    pub async fn launch_emulated(
        &self,
        emulator_path: &str,
        rom_iso_path: &str,
        emulator_args: Option<&str>,
    ) -> Result<LaunchResult, String> {
        let emulator_path = emulator_path.to_string();
        let rom_iso_path = rom_iso_path.to_string();
        let emulator_args = emulator_args.map(|s| s.to_string());

        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&emulator_path);

            if let Some(args) = &emulator_args {
                cmd.args(args.split_whitespace());
            }
            cmd.arg(&rom_iso_path);

            match cmd.spawn() {
                Ok(child) => {
                    let pid = child.id();
                    std::mem::forget(child);
                    Ok(LaunchResult {
                        success: true,
                        game_id: None,
                        message: format!("Lanzado emulador: {}", emulator_path),
                        process_id: Some(pid),
                    })
                }
                Err(e) => Ok(LaunchResult {
                    success: false,
                    game_id: None,
                    message: format!("No se pudo lanzar el emulador '{}': {}", emulator_path, e),
                    process_id: None,
                }),
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Lanza un URI (steam://, com.epicgames.launcher://, https://...).
    pub async fn launch_uri(&self, uri: &str) -> Result<LaunchResult, String> {
        let uri = uri.to_string();

        tokio::task::spawn_blocking(move || {
            #[cfg(windows)]
            {
                let mut cmd = Command::new("cmd");
                cmd.args(["/C", "start", "", &uri]);

                match cmd.spawn() {
                    Ok(child) => {
                        let pid = child.id();
                        std::mem::forget(child);
                        Ok(LaunchResult {
                            success: true,
                            game_id: None,
                            message: format!("URI lanzado: {}", uri),
                            process_id: Some(pid),
                        })
                    }
                    Err(e) => Ok(LaunchResult {
                        success: false,
                        game_id: None,
                        message: format!("No se pudo lanzar el URI '{}': {}", uri, e),
                        process_id: None,
                    }),
                }
            }

            #[cfg(not(windows))]
            {
                Err(format!(
                    "Los esquemas URI ({}) solo están soportados en Windows por ahora",
                    uri
                ))
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

impl Default for LauncherManager {
    fn default() -> Self {
        Self::new()
    }
}
