-- Migración 001: Esquema inicial de Atlas Launcher
-- Tablas: platforms, sagas, games, emulators, game_emulators, metadata

-- Plataformas de origen
CREATE TABLE IF NOT EXISTS platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    accent_color TEXT NOT NULL DEFAULT '#ffffff',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Colecciones de sagas
CREATE TABLE IF NOT EXISTS sagas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Juegos registrados
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    display_name TEXT,
    saga_id INTEGER REFERENCES sagas(id),
    platform_id INTEGER REFERENCES platforms(id),
    executable_path TEXT NOT NULL,
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

-- Emuladores detectados en el sistema
CREATE TABLE IF NOT EXISTS emulators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    executable_path TEXT NOT NULL,
    supported_extensions TEXT NOT NULL DEFAULT '.iso,.rom,.bin,.cue,.nsp,.xci',
    default_arguments TEXT,
    is_verified BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Mapeo juego -> emulador (para juegos emulados)
CREATE TABLE IF NOT EXISTS game_emulators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    emulator_id INTEGER NOT NULL REFERENCES emulators(id) ON DELETE CASCADE,
    launch_arguments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, emulator_id)
);

-- Metadatos enriquecidos (caché de APIs externas)
CREATE TABLE IF NOT EXISTS metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual', -- igdb, steamgriddb, manual
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

-- Índices compuestos para búsquedas rápidas (< 2ms)
CREATE INDEX IF NOT EXISTS idx_games_saga_id ON games(saga_id);
CREATE INDEX IF NOT EXISTS idx_games_platform_id ON games(platform_id);
CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);
CREATE INDEX IF NOT EXISTS idx_games_is_emulated ON games(is_emulated);
CREATE INDEX IF NOT EXISTS idx_games_installed ON games(installed);
CREATE INDEX IF NOT EXISTS idx_games_release_year ON games(release_year);
CREATE INDEX IF NOT EXISTS idx_metadata_game_id ON metadata(game_id);
CREATE INDEX IF NOT EXISTS idx_game_emulators_game_id ON game_emulators(game_id);

-- Datos iniciales de plataformas
INSERT OR IGNORE INTO platforms (name, display_name, accent_color) VALUES
    ('steam', 'Steam', '#0a98fc'),
    ('epic', 'Epic Games Store', '#5f128d'),
    ('gog', 'GOG', '#ff4500'),
    ('emulator', 'Emulador', '#00ff88'),
    ('custom', 'Personalizado', '#ffcc00');

-- Datos iniciales de emuladores comunes
INSERT OR IGNORE INTO emulators (name, executable_path, supported_extensions, is_verified) VALUES
    ('Dolphin', '', '.iso,.gcm,.wbfs,.ciso,.nkit', 0),
    ('RetroArch', '', '.nes,.snes,.gb,.gba,.nds,.pce,.md,.gen,.smd,.iso,.bin,.cue', 0),
    ('Ryujinx', '', '.nsp,.xci,.nsz,.xcz', 0),
    ('mGBA', '', '.gba,.gbc', 0),
    ('DOSBox', '', '.exe,.conf,.bat', 0),
    ('PCSX2', '', '.iso,.bin,.cue,.img,.mdf', 0),
    ('RPCS3', '', '.pkg,.iso,.iso.ps3', 0);
