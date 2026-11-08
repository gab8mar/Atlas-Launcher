use std::collections::HashSet;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

/// Resultado resumido de un escaneo de biblioteca
#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub games_found: usize,
    pub emulators_found: usize,
    pub platforms_scanned: Vec<String>,
    pub errors: Vec<String>,
}

/// Resultado completo del escaneo (resumen + juegos detectados)
pub struct ScanOutcome {
    pub result: ScanResult,
    pub games: Vec<DetectedGame>,
}

/// Información de un juego detectado
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DetectedGame {
    pub name: String,
    pub platform: String,
    pub executable_path: Option<String>,
    pub rom_iso_path: Option<String>,
    pub saga: Option<String>,
    pub console: Option<String>,
    pub release_year: Option<i32>,
}

impl DetectedGame {
    fn new(name: String, platform: &str) -> Self {
        Self {
            name,
            platform: platform.to_string(),
            executable_path: None,
            rom_iso_path: None,
            saga: None,
            console: Some("PC".to_string()),
            release_year: None,
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                                  STEAM                                     */
/* -------------------------------------------------------------------------- */

pub struct SteamScanner;

impl SteamScanner {
    pub fn new() -> Self {
        Self
    }

    pub fn scan(&self) -> Result<Vec<DetectedGame>, String> {
        let mut games = Vec::new();
        let mut visited: HashSet<PathBuf> = HashSet::new();

        for steamapps in steamapps_directories() {
            if !visited.insert(steamapps.clone()) {
                continue;
            }
            let entries = match std::fs::read_dir(&steamapps) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let is_acf = path
                    .extension()
                    .map(|e| e.eq_ignore_ascii_case("acf"))
                    .unwrap_or(false);
                if !is_acf {
                    continue;
                }

                if let Some(game) = self.parse_acf(&path, &steamapps) {
                    games.push(game);
                }
            }
        }

        Ok(games)
    }

    fn parse_acf(&self, path: &Path, steamapps: &Path) -> Option<DetectedGame> {
        let content = std::fs::read_to_string(path).ok()?;
        let appid = extract_acf_value(&content, "appid")?;
        let name = extract_acf_value(&content, "name")?;
        let installdir = extract_acf_value(&content, "installdir")?;

        // Ignorar redistribuibles / herramientas que no son juegos
        let lower = name.to_lowercase();
        if lower.contains("steamworks common redistributables")
            || lower.contains("steam linux runtime")
            || lower.contains("proton")
        {
            return None;
        }

        let install_path = steamapps.join("common").join(&installdir);

        let mut game = DetectedGame::new(name, "steam");
        // Lanzar mediante el protocolo oficial de Steam evita problemas de DRM/overlay.
        game.executable_path = Some(format!("steam://rungameid/{}", appid));
        game.console = Some("PC".to_string());
        let _ = install_path;

        Some(game)
    }
}

/// Devuelve las carpetas `steamapps` de Steam y de todas sus bibliotecas.
fn steamapps_directories() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;

        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
            if let Ok(path) = key.get_value::<String, _>("SteamPath") {
                roots.push(PathBuf::from(path.replace('/', "\\")));
            }
        }
        if let Ok(key) =
            RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
        {
            if let Ok(path) = key.get_value::<String, _>("InstallPath") {
                roots.push(PathBuf::from(path));
            }
        }
    }

    roots.push(PathBuf::from("C:\\Program Files (x86)\\Steam"));
    roots.push(PathBuf::from("C:\\Program Files\\Steam"));

    let mut steamapps: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    for root in roots {
        let main = root.join("steamapps");
        if !main.exists() {
            continue;
        }

        for vdf in [
            main.join("libraryfolders.vdf"),
            root.join("config").join("libraryfolders.vdf"),
        ] {
            if let Ok(content) = std::fs::read_to_string(&vdf) {
                for library in extract_vdf_paths(&content) {
                    let library_path = PathBuf::from(library);
                    let library_steamapps = library_path.join("steamapps");
                    if library_steamapps.exists() && seen.insert(library_steamapps.clone()) {
                        steamapps.push(library_steamapps);
                    }
                }
            }
        }

        if seen.insert(main.clone()) {
            steamapps.push(main);
        }
    }

    steamapps
}

fn extract_vdf_paths(content: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut rest = content;

    while let Some(index) = rest.find("\"path\"") {
        rest = &rest[index + 6..];
        if let Some(open) = rest.find('"') {
            let after_open = &rest[open + 1..];
            if let Some(close) = after_open.find('"') {
                let value = &after_open[..close];
                paths.push(value.replace("\\\\", "\\"));
                rest = &after_open[close + 1..];
                continue;
            }
        }
        break;
    }

    paths
}

fn extract_acf_value(content: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\"", key);
    let start = content.find(&pattern)?;
    let after_key = &content[start + pattern.len()..];
    let value_start = after_key.find('"')? + 1;
    let value_end = after_key[value_start..].find('"')?;
    Some(after_key[value_start..value_start + value_end].to_string())
}

/* -------------------------------------------------------------------------- */
/*                                   EPIC                                     */
/* -------------------------------------------------------------------------- */

pub struct EpicScanner;

impl EpicScanner {
    pub fn new() -> Self {
        Self
    }

    pub fn scan(&self) -> Result<Vec<DetectedGame>, String> {
        let mut games = Vec::new();
        let manifests = PathBuf::from("C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests");

        if !manifests.exists() {
            return Ok(games);
        }

        let entries = match std::fs::read_dir(&manifests) {
            Ok(e) => e,
            Err(e) => return Err(format!("No se pudo leer manifiestos de Epic: {}", e)),
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("item"))
                .unwrap_or(false)
            {
                continue;
            }

            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let value: serde_json::Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let name = match value.get("DisplayName").and_then(|v| v.as_str()) {
                Some(n) if !n.trim().is_empty() => n.to_string(),
                _ => continue,
            };

            let install_location = value
                .get("InstallLocation")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let launch_exe = value
                .get("LaunchExecutable")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .replace('/', "\\");
            let app_name = value
                .get("AppName")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let exe_path = if install_location.is_empty() || launch_exe.is_empty() {
                None
            } else {
                Some(Path::new(install_location).join(launch_exe))
            };

            let mut game = DetectedGame::new(name, "epic");
            game.executable_path = match exe_path {
                Some(p) if p.exists() => Some(p.to_string_lossy().to_string()),
                _ if !app_name.is_empty() => Some(format!(
                    "com.epicgames.launcher://apps/{}?action=launch&silent=true",
                    app_name
                )),
                _ => continue,
            };
            games.push(game);
        }

        Ok(games)
    }
}

/* -------------------------------------------------------------------------- */
/*                                   GOG                                      */
/* -------------------------------------------------------------------------- */

pub struct GogScanner;

impl GogScanner {
    pub fn new() -> Self {
        Self
    }

    pub fn scan(&self) -> Result<Vec<DetectedGame>, String> {
        #[cfg(windows)]
        {
            use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

            let mut games = Vec::new();

            let hives = [
                (
                    winreg::RegKey::predef(HKEY_LOCAL_MACHINE),
                    "SOFTWARE\\WOW6432Node\\GOG.com\\Games",
                ),
                (
                    winreg::RegKey::predef(HKEY_CURRENT_USER),
                    "Software\\GOG.com\\Games",
                ),
            ];

            for (hive, subkey) in hives {
                let key = match hive.open_subkey(subkey) {
                    Ok(k) => k,
                    Err(_) => continue,
                };

                for name in key.enum_keys().flatten() {
                    let game_key = match key.open_subkey(&name) {
                        Ok(k) => k,
                        Err(_) => continue,
                    };

                    let display_name: String = game_key
                        .get_value("gameName")
                        .or_else(|_| game_key.get_value("GAMENAME"))
                        .unwrap_or_default();
                    if display_name.trim().is_empty() {
                        continue;
                    }

                    let install_path: String = game_key
                        .get_value("path")
                        .or_else(|_| game_key.get_value("PATH"))
                        .unwrap_or_default();
                    let exe: String = game_key
                        .get_value("exe")
                        .or_else(|_| game_key.get_value("EXE"))
                        .unwrap_or_default();

                    let exe_path = if install_path.is_empty() || exe.is_empty() {
                        None
                    } else {
                        Some(Path::new(&install_path).join(exe.replace('/', "\\")))
                    };

                    let mut game = DetectedGame::new(display_name, "gog");
                    game.executable_path = exe_path
                        .filter(|p| p.exists())
                        .map(|p| p.to_string_lossy().to_string());
                    games.push(game);
                }
            }

            Ok(games)
        }

        #[cfg(not(windows))]
        {
            Ok(Vec::new())
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                         ACCESOS DIRECTOS DEL ESCRITORIO                    */
/* -------------------------------------------------------------------------- */

pub struct DesktopScanner;

impl DesktopScanner {
    pub fn new() -> Self {
        Self
    }

    pub fn scan(&self) -> Result<Vec<DetectedGame>, String> {
        #[cfg(windows)]
        {
            let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'))
$items = @()
foreach ($dir in $dirs) {
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -Filter *.lnk -File | ForEach-Object {
      $shortcut = $shell.CreateShortcut($_.FullName)
      $items += [pscustomobject]@{
        Name = $_.BaseName
        Target = $shortcut.TargetPath
        Arguments = $shortcut.Arguments
        WorkDir = $shortcut.WorkingDirectory
      }
    }
  }
}
ConvertTo-Json -InputObject @($items) -Compress
"#;

            let output = std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    script,
                ])
                .output()
                .map_err(|e| format!("No se pudo ejecutar PowerShell: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.trim().is_empty() {
                return Ok(Vec::new());
            }

            let value: serde_json::Value = serde_json::from_str(stdout.trim())
                .map_err(|e| format!("Respuesta inválida de PowerShell: {}", e))?;

            let entries: Vec<serde_json::Value> = match value {
                serde_json::Value::Array(items) => items,
                other => vec![other],
            };

            let mut games = Vec::new();
            let mut seen: HashSet<String> = HashSet::new();

            for item in entries {
                let name = item
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let target = item
                    .get("Target")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();

                if name.is_empty() || target.is_empty() {
                    continue;
                }

                let target_path = PathBuf::from(&target);
                let is_executable = target_path
                    .extension()
                    .map(|e| e.eq_ignore_ascii_case("exe"))
                    .unwrap_or(false);

                if !is_executable || !target_path.exists() {
                    continue;
                }

                if is_non_game_shortcut(&name, &target_path) {
                    continue;
                }

                let key = target.to_lowercase();
                if !seen.insert(key) {
                    continue;
                }

                let mut game = DetectedGame::new(clean_shortcut_name(&name), "custom");
                game.executable_path = Some(target);
                game.console = Some("PC".to_string());
                games.push(game);
            }

            return Ok(games);
        }

        #[cfg(not(windows))]
        {
            Ok(Vec::new())
        }
    }
}

fn clean_shortcut_name(name: &str) -> String {
    name.replace(" - Acceso directo", "")
        .replace(" - Shortcut", "")
        .trim()
        .to_string()
}

fn is_non_game_shortcut(name: &str, target: &Path) -> bool {
    const EXACT: &[&str] = &[
        "go", "sourcetree", "opencode", "scrcpy", "zoom", "discord", "steam", "brave",
        "chrome", "msedge", "firefox", "opera", "vivaldi", "obs64", "obs32", "vlc",
        "audacity", "gimp-3.2", "gimp-3.0", "inkscape", "krita", "libresprite",
        "qbittorrent", "rustdesk", "irium", "forticlient", "acrord32", "epson",
        "unins000", "uninstall", "antigravity", "notepad", "pcsx2", "pcsx2-qt",
        "retroarch", "dolphin", "rpcs3", "ryujinx", "mgba", "dosbox", "atlas launcher",
        "atlas-launcher",
    ];
    const CONTAINS: &[&str] = &[
        "uninstall", "desinstalar", "readme", "servidor", "escritorio remoto",
        "chrome remote", "vpn", "webcam", "driver", "actualiz", "update", "audacity",
        "gimp",
    ];

    let lower_name = name.to_lowercase();
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let target_lower = target.to_string_lossy().to_lowercase();

    if EXACT.iter().any(|item| stem == *item || lower_name == *item) {
        return true;
    }

    if CONTAINS
        .iter()
        .any(|item| lower_name.contains(item) || target_lower.contains(item))
    {
        return true;
    }

    // El propio launcher nunca debe aparecer como juego.
    if target_lower.ends_with("atlas-launcher.exe") {
        return true;
    }

    // Rutas típicas de utilidades del sistema, no de juegos.
    target_lower.contains("\\windows\\")
        || target_lower.contains("\\program files\\google\\")
        || target_lower.contains("\\program files\\microsoft\\edge")
        || target_lower.contains("\\program files\\mozilla")
        || target_lower.contains("\\program files\\brave")
        || target_lower.contains("\\program files\\discord")
}

/* -------------------------------------------------------------------------- */
/*                        EMULADORES Y ROMS / ISOS                            */
/* -------------------------------------------------------------------------- */

pub struct EmulatorScanner;

impl EmulatorScanner {
    pub fn new() -> Self {
        Self
    }

    /// Detecta emuladores instalados en rutas habituales.
    pub fn detect_installed(&self) -> Vec<(String, PathBuf)> {
        let candidates: &[(&str, &[&str])] = &[
            (
                "RetroArch",
                &[
                    "C:\\RetroArch-Win64\\retroarch.exe",
                    "C:\\RetroArch\\retroarch.exe",
                    "D:\\RetroArch-Win64\\retroarch.exe",
                ],
            ),
            (
                "Dolphin",
                &[
                    "C:\\Program Files\\Dolphin\\Dolphin.exe",
                    "C:\\Program Files (x86)\\Dolphin\\Dolphin.exe",
                    "C:\\Dolphin\\Dolphin.exe",
                ],
            ),
            (
                "PCSX2",
                &[
                    "C:\\Program Files\\PCSX2\\pcsx2-qt.exe",
                    "C:\\Program Files (x86)\\PCSX2\\pcsx2-qt.exe",
                    "C:\\PCSX2\\pcsx2-qt.exe",
                ],
            ),
            (
                "RPCS3",
                &["C:\\RPCS3\\rpcs3.exe", "C:\\Program Files\\RPCS3\\rpcs3.exe"],
            ),
            (
                "Ryujinx",
                &[
                    "C:\\Ryujinx\\Ryujinx.exe",
                    "C:\\Program Files\\Ryujinx\\Ryujinx.exe",
                ],
            ),
            (
                "mGBA",
                &[
                    "C:\\Program Files\\mGBA\\mGBA.exe",
                    "C:\\Program Files (x86)\\mGBA\\mGBA.exe",
                ],
            ),
            (
                "DOSBox",
                &[
                    "C:\\Program Files\\DOSBox-0.74-3\\DOSBox.exe",
                    "C:\\Program Files (x86)\\DOSBox-0.74-3\\DOSBox.exe",
                ],
            ),
        ];

        let mut found = Vec::new();
        for (name, paths) in candidates {
            for path in *paths {
                let p = PathBuf::from(path);
                if p.exists() {
                    found.push((name.to_string(), p));
                    break;
                }
            }
        }
        found
    }
}

/* -------------------------------------------------------------------------- */
/*                              ESCANEO COMPLETO                              */
/* -------------------------------------------------------------------------- */

const ROM_EXTENSIONS: &[&str] = &[
    "iso", "bin", "cue", "nsp", "xci", "gba", "gbc", "nes", "sfc", "snes", "md", "gen", "gcm",
    "wbfs", "ciso", "nkit", "chd", "nds", "3ds", "cia",
];

fn scan_rom_directory(dir: &Path, depth: usize, games: &mut Vec<DetectedGame>) {
    if depth == 0 || !dir.exists() {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_rom_directory(&path, depth - 1, games);
            continue;
        }

        let extension = match path.extension() {
            Some(e) => e.to_string_lossy().to_lowercase(),
            None => continue,
        };

        if !ROM_EXTENSIONS.contains(&extension.as_str()) {
            continue;
        }

        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut game = DetectedGame::new(name, "emulator");
        game.rom_iso_path = Some(path.to_string_lossy().to_string());
        game.console = None;
        games.push(game);
    }
}

pub fn full_scan() -> ScanOutcome {
    let mut games = Vec::new();
    let mut errors = Vec::new();
    let mut platforms_scanned = Vec::new();

    let emulator_scanner = EmulatorScanner::new();
    let installed_emulators = emulator_scanner.detect_installed();

    match SteamScanner::new().scan() {
        Ok(mut found) => {
            platforms_scanned.push("steam".to_string());
            games.append(&mut found);
        }
        Err(e) => errors.push(format!("Steam: {}", e)),
    }

    match EpicScanner::new().scan() {
        Ok(mut found) => {
            platforms_scanned.push("epic".to_string());
            games.append(&mut found);
        }
        Err(e) => errors.push(format!("Epic: {}", e)),
    }

    match GogScanner::new().scan() {
        Ok(mut found) => {
            platforms_scanned.push("gog".to_string());
            games.append(&mut found);
        }
        Err(e) => errors.push(format!("GOG: {}", e)),
    }

    match DesktopScanner::new().scan() {
        Ok(mut found) => {
            platforms_scanned.push("desktop".to_string());
            games.append(&mut found);
        }
        Err(e) => errors.push(format!("Escritorio: {}", e)),
    }

    // ROMs/ISOs en carpetas habituales (si existen)
    let rom_roots = [
        "C:\\Emuladores",
        "C:\\Emulation",
        "C:\\ROMs",
        "D:\\Emuladores",
        "D:\\Emulation",
        "D:\\ROMs",
        "D:\\Roms",
    ];
    let mut rom_games = Vec::new();
    for root in rom_roots {
        let path = PathBuf::from(root);
        if path.exists() {
            scan_rom_directory(&path, 5, &mut rom_games);
        }
    }
    if !rom_games.is_empty() {
        platforms_scanned.push("emulator".to_string());
        games.append(&mut rom_games);
    }

    // Asignar saga a todos los juegos detectados
    for game in &mut games {
        game.saga = crate::sagas::detect_saga(&game.name).map(|s| s.to_string());
    }

    let result = ScanResult {
        games_found: games.len(),
        emulators_found: installed_emulators.len(),
        platforms_scanned,
        errors,
    };

    ScanOutcome { result, games }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acf_value_extraction() {
        let content = "\"AppState\"\n{\n\t\"appid\"\t\t\"123\"\n\t\"name\"\t\t\"Test Game\"\n}";
        assert_eq!(extract_acf_value(content, "appid").as_deref(), Some("123"));
        assert_eq!(
            extract_acf_value(content, "name").as_deref(),
            Some("Test Game")
        );
    }

    #[test]
    fn vdf_paths_extraction() {
        let content = "\"libraryfolders\"\n{\n \"0\" { \"path\" \"C:\\\\Games\" }\n}";
        assert_eq!(extract_vdf_paths(content), vec!["C:\\Games".to_string()]);
    }
}
