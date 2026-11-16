# Protocolo de Build y Rutas de Atlas Launcher

## 1. Por qué existen dos rutas (`C:` y `E:`)
- **`E:\Atlas-Launcher`**: Es el repositorio oficial y espacio de trabajo del código fuente (frontend React + Vite y backend Rust / Tauri).
- **`C:\atlas-build`**: Es el directorio de compilación configurado en `src-tauri/.cargo/config.toml` (`target-dir = "C:/atlas-build"`). Se definió así para acelerar la compilación de Rust usando la unidad de sistema SSD `C:`, evitando saturar o ralentizar la unidad `E:`. El binario de release generado se ubica en `C:\atlas-build\release\atlas-launcher.exe`.

## 2. REGLA CRÍTICA: Nunca compilar con `cargo build --release` a secas
- Si se compila únicamente con `cargo build --release`, Tauri v2 asume modo desarrollo y busca el servidor Vite en `http://localhost:1420` (`devUrl`).
- Al abrir el `.exe` compilado solo con `cargo`, la ventana muestra el error:
  **"Vaya... no se puede obtener acceso a esta página. localhost rechazó la conexión. ERR_CONNECTION_REFUSED"**.
- **Comando OBLIGATORIO para compilar la aplicación:**
  ```cmd
  cmd /c "npm run tauri -- build --no-bundle"
  ```
  Esto ejecuta automáticamente `npm run build` (generando los estáticos en `dist/`) y le ordena a Tauri incrustar el HTML, CSS y JS compilados dentro del propio archivo binario.

## 3. Subsystem de Windows (Sin consola negra emergente)
- En `src-tauri/src/main.rs`, la cabecera DEBE mantener siempre:
  ```rust
  #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
  ```
  Esto garantiza que el sistema operativo Windows no abra una segunda ventana de terminal / consola de comandos negra.
