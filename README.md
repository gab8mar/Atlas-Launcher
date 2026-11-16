# Atlas Launcher

Launcher de escritorio para unificar toda tu biblioteca de videojuegos en un solo lugar.

Atlas Launcher detecta automáticamente los juegos instalados en tu PC y los presenta en un
catálogo visual tipo "Netflix", una vista de lista y colecciones por saga.

## Características

- **Escaneo real del equipo** (sin juegos de demostración):
  - Bibliotecas de Steam (todas las carpetas de `libraryfolders.vdf`).
  - Epic Games Store (manifiestos `.item`).
  - GOG (registro de Windows).
  - Accesos directos de juegos del escritorio (usuario y público).
  - Emuladores y ROMs/ISOs en carpetas habituales.
- **Catálogo tipo Netflix**: portada, nombre y año, con vista de cuadrícula, lista y sagas.
- **Detección de sagas**: agrupa automáticamente franquicias como *Dragon Age*, *XCOM*,
  *The Legend of Zelda*, *Final Fantasy*, etc.
- **Búsqueda y filtros** por plataforma y saga.
- **Lanzamiento** de ejecutables nativos, juegos de Steam (`steam://rungameid/...`),
  Epic y emuladores con ROM/ISO.
- **Persistencia en SQLite**: la biblioteca se conserva entre sesiones y los juegos
  desinstalados dejan de mostrarse tras el siguiente escaneo.
- **Actualizaciones integradas**: el botón *Actualizar* consulta los releases de GitHub,
  descarga el instalador más reciente y lo ejecuta.

## Tecnologías

- [Tauri 2](https://tauri.app/) (Rust) para el backend nativo.
- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/).
- [Tailwind CSS](https://tailwindcss.com/) para la interfaz.
- [SQLite](https://sqlite.org/) vía [SQLx](https://github.com/launchbadge/sqlx).

## Requisitos

- Windows 10/11.
- [Rust](https://rustup.rs/) (toolchain estable).
- [Node.js](https://nodejs.org/) 18 o superior.
- WebView2 (incluido en Windows 10/11 actualizados).

## Desarrollo

```bash
npm install
npm run tauri dev
```

## Compilar

```bash
npm run tauri build
```

El ejecutable y los instaladores se generan en `src-tauri/target/release/bundle/`
(o en el `target-dir` configurado en tu entorno).

## Publicar una nueva versión

1. Actualiza la versión en `package.json`, `src-tauri/Cargo.toml` y
   `src-tauri/tauri.conf.json` (deben coincidir).
2. Crea y sube el tag:

   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. GitHub Actions compila la aplicación y crea un **draft release** con los instaladores
   `.exe` (NSIS) y `.msi`. Publícalo desde GitHub para que el botón *Actualizar* del
   launcher lo detecte.

Los pushes a `main` y las pull requests compilan el proyecto (sin publicar release) y
suben los instaladores como artefactos del workflow.

## Estructura del proyecto

```
src/                 Interfaz React (catálogo, lista, sagas)
src-tauri/src/
  commands/          Comandos IPC expuestos a la interfaz
  database/          Esquema y persistencia SQLite
  launcher/          Lanzamiento nativo, emulado y por URI
  metadata/          Cliente de IGDB / SteamGridDB y caché WebP de portadas
  sagas/             Detección y agrupación de sagas
  scanners/          Detectores de Steam, Epic, GOG, escritorio y ROMs
  updater/           Comprobación y descarga de releases desde GitHub
```

## Metadatos y portadas

Atlas Launcher puede completar la información de cada juego (año, género, nota y
carátula) usando dos servicios externos:

- **IGDB** — datos del juego y carátula de respaldo.
- **SteamGridDB** — carátula vertical 600×900, banner y logo.

Configura las claves desde **Ajustes de metadatos** en la barra lateral (o con las
variables de entorno `ATLAS_IGDB_CLIENT_ID`, `ATLAS_IGDB_CLIENT_SECRET` y
`ATLAS_STEAMGRIDDB_API_KEY`). Las claves se guardan en
`%LOCALAPPDATA%\AtlasLauncher\metadata.json` y nunca se incluyen en el repositorio.

- **Buscar automático** (dentro del editor de un juego) descarga los metadatos y la
  portada de ese título.
- **Portadas automáticas** (barra lateral) completa hasta 12 juegos que aún no tienen
  carátula y muestra el progreso en tiempo real.

Las imágenes se convierten a WebP sin pérdida y se guardan en la carpeta de datos
locales de la aplicación.

## Estado del proyecto

Atlas Launcher está en desarrollo activo. Funciona el escaneo, el catálogo, el lanzamiento
y la persistencia. La descarga automática de carátulas y metadatos (IGDB/SteamGridDB) ya
está integrada. El editor de entradas manuales también está disponible. Las siguientes
mejoras planificadas son el lanzamiento de ROMs con emuladores configurados y los filtros
avanzados (año, género, valoración).

## Licencia

[MIT](LICENSE)
