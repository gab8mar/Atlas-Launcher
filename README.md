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

## Estructura del proyecto

```
src/                 Interfaz React (catálogo, lista, sagas)
src-tauri/src/
  commands/          Comandos IPC expuestos a la interfaz
  database/          Esquema y persistencia SQLite
  launcher/          Lanzamiento nativo, emulado y por URI
  metadata/          Cliente de metadatos (IGDB / SteamGridDB, en desarrollo)
  sagas/             Detección y agrupación de sagas
  scanners/          Detectores de Steam, Epic, GOG, escritorio y ROMs
```

## Estado del proyecto

Atlas Launcher está en desarrollo activo. Funciona el escaneo, el catálogo, el lanzamiento
y la persistencia. La descarga automática de carátulas y metadatos (IGDB/SteamGridDB) y el
editor de entradas manuales están planificados.

## Licencia

[MIT](LICENSE)
