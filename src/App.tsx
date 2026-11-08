import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
  BookOpen,
  Cpu,
  Edit3,
  FolderOpen,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { FixedSizeList as List } from 'react-window';

/* ----------------------------- Tipos ----------------------------- */

interface Game {
  id: number;
  name: string;
  saga: string | null;
  release_year: number | null;
  console: string | null;
  cover_path: string | null;
  platform: string;
  executable_path: string;
  arguments: string | null;
  rom_iso_path: string | null;
  is_emulated: boolean;
  play_time_minutes: number;
  last_played: string | null;
}

interface SagaGroup {
  name: string;
  games: Game[];
}

interface ScanResult {
  games_found: number;
  emulators_found: number;
  platforms_scanned: string[];
  errors: string[];
}

type View = 'catalog' | 'list' | 'sagas';

const PLATFORM_COLORS: Record<string, string> = {
  steam: '#0a98fc',
  epic: '#8b5cf6',
  gog: '#ff4500',
  emulator: '#00ff88',
  custom: '#ffcc00',
};

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'STEAM',
  epic: 'EPIC',
  gog: 'GOG',
  emulator: 'EMULADOR',
  custom: 'PC',
};

/* --------------------------- Utilidades -------------------------- */

async function invokeCmd<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

function coverSource(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

function groupBySaga(games: Game[]): SagaGroup[] {
  const map = new Map<string, Game[]>();
  for (const game of games) {
    const saga = game.saga || 'Sin saga';
    if (!map.has(saga)) {
      map.set(saga, []);
    }
    map.get(saga)!.push(game);
  }

  // Orden cronológico por año de lanzamiento dentro de cada saga
  for (const list of map.values()) {
    list.sort((a, b) => {
      const yearA = a.release_year ?? 9999;
      const yearB = b.release_year ?? 9999;
      if (yearA !== yearB) return yearA - yearB;
      return a.name.localeCompare(b.name);
    });
  }

  return Array.from(map.entries())
    .map(([name, list]) => ({ name, games: list }))
    .sort((a, b) => {
      if (a.name === 'Sin saga') return 1;
      if (b.name === 'Sin saga') return -1;
      return a.name.localeCompare(b.name);
    });
}

function posterGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 45) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 70%, 18%) 0%, hsl(${h2}, 80%, 8%) 100%)`;
}

function formatPlaytime(minutes: number): string {
  if (!minutes || minutes <= 0) return '0h';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

/* -------------------------- Componentes -------------------------- */

function Poster({ game, className }: { game: Game; className?: string }) {
  const [imageError, setImageError] = useState(false);
  const src = coverSource(game.cover_path);

  if (src && !imageError) {
    return (
      <img
        src={src}
        alt={game.name}
        onError={() => setImageError(true)}
        className={`aspect-[2/3] w-full rounded object-cover shadow-lg ${className ?? ''}`}
      />
    );
  }

  return (
    <div
      style={{ background: posterGradient(game.name) }}
      className={`relative flex aspect-[2/3] w-full flex-col justify-between overflow-hidden rounded border border-gray-800 p-3 shadow-lg ${
        className ?? ''
      }`}
    >
      <div className="flex items-center justify-between text-gray-500">
        <Gamepad2 className="h-5 w-5 text-gray-400/60" />
        <span className="font-mono text-[9px] uppercase tracking-wider text-gray-400">
          {game.console || 'PC'}
        </span>
      </div>

      <div>
        <p className="line-clamp-3 text-xs font-bold leading-tight text-white drop-shadow">
          {game.name}
        </p>
        {game.release_year && (
          <p className="mt-1 font-mono text-[10px] text-gray-400">{game.release_year}</p>
        )}
      </div>

      <div className="font-mono text-[8px] uppercase tracking-widest text-gray-500">
        {PLATFORM_LABELS[game.platform] || game.platform}
      </div>
    </div>
  );
}

/* -------------------------- Modal Editor ------------------------- */

interface EditModalProps {
  game: Game | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: Game) => void;
  onDelete: (id: number) => void;
}

function EditGameModal({ game, isOpen, onClose, onSave, onDelete }: EditModalProps) {
  const [name, setName] = useState('');
  const [saga, setSaga] = useState('');
  const [releaseYear, setReleaseYear] = useState<string>('');
  const [consoleName, setConsoleName] = useState('');
  const [executablePath, setExecutablePath] = useState('');
  const [args, setArgs] = useState('');
  const [coverPath, setCoverPath] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (game) {
      setName(game.name);
      setSaga(game.saga || '');
      setReleaseYear(game.release_year ? String(game.release_year) : '');
      setConsoleName(game.console || 'PC');
      setExecutablePath(game.executable_path || '');
      setArgs(game.arguments || '');
      setCoverPath(game.cover_path || '');
    }
  }, [game]);

  if (!isOpen || !game) return null;

  async function handleSave() {
    if (!game) return;
    setSaving(true);
    try {
      const year = releaseYear ? parseInt(releaseYear, 10) : null;
      await invokeCmd('update_game', {
        id: game.id,
        name,
        saga: saga.trim() ? saga.trim() : null,
        releaseYear: isNaN(year as number) ? null : year,
        console: consoleName.trim() ? consoleName.trim() : null,
        executablePath,
        arguments: args.trim() ? args.trim() : null,
        coverPath: coverPath.trim() ? coverPath.trim() : null,
      });

      onSave({
        ...game,
        name,
        saga: saga.trim() ? saga.trim() : null,
        release_year: isNaN(year as number) ? null : year,
        console: consoleName.trim() ? consoleName.trim() : null,
        executable_path: executablePath,
        arguments: args.trim() ? args.trim() : null,
        cover_path: coverPath.trim() ? coverPath.trim() : null,
      });
      onClose();
    } catch (err) {
      alert(`Error al guardar: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar "${game.name}" de la biblioteca de Atlas Launcher?`)) return;
    try {
      await invokeCmd('delete_game', { id: game.id });
      onDelete(game.id);
      onClose();
    } catch (err) {
      alert(`Error al eliminar: ${err}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-xl border border-gray-700 bg-atlas-panel p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 pb-4">
          <div className="flex items-center gap-2">
            <Edit3 className="h-5 w-5 text-neon-pink" />
            <h3 className="text-lg font-bold uppercase tracking-wider text-white">
              Editar Registro de Juego
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
              Nombre del Juego
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="atlas-input mt-1 w-full text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Colección / Saga (ej. Zelda, AC)
              </label>
              <input
                type="text"
                value={saga}
                onChange={(e) => setSaga(e.target.value)}
                placeholder="Sin saga"
                className="atlas-input mt-1 w-full text-sm"
              />
            </div>
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Año de Lanzamiento
              </label>
              <input
                type="number"
                value={releaseYear}
                onChange={(e) => setReleaseYear(e.target.value)}
                placeholder="2024"
                className="atlas-input mt-1 w-full text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Consola / Plataforma
              </label>
              <input
                type="text"
                value={consoleName}
                onChange={(e) => setConsoleName(e.target.value)}
                placeholder="PC, NES, Switch..."
                className="atlas-input mt-1 w-full text-sm"
              />
            </div>
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Argumentos CLI (Flags)
              </label>
              <input
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-DX11 -fullscreen"
                className="atlas-input mt-1 w-full text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
              Ruta del Ejecutable o URI Scheme
            </label>
            <input
              type="text"
              value={executablePath}
              onChange={(e) => setExecutablePath(e.target.value)}
              className="atlas-input mt-1 w-full text-xs font-mono"
            />
          </div>

          <div>
            <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
              Carátula (URL web o ruta local de imagen)
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={coverPath}
                onChange={(e) => setCoverPath(e.target.value)}
                placeholder="https://... o C:\caratula.png"
                className="atlas-input flex-1 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-gray-800 pt-4">
          <button
            type="button"
            onClick={handleDelete}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" /> Eliminar
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-700 px-4 py-2 font-mono text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="atlas-btn-cyan px-5 py-2 font-mono text-xs disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------- Modal Añadir Manual ------------------- */

interface AddGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

function AddGameModal({ isOpen, onClose, onAdded }: AddGameModalProps) {
  const [name, setName] = useState('');
  const [executablePath, setExecutablePath] = useState('');
  const [args, setArgs] = useState('');
  const [saga, setSaga] = useState('');
  const [consoleName, setConsoleName] = useState('PC');
  const [releaseYear, setReleaseYear] = useState('');
  const [coverPath, setCoverPath] = useState('');
  const [adding, setAdding] = useState(false);

  if (!isOpen) return null;

  async function handleAdd() {
    if (!name.trim() || !executablePath.trim()) {
      alert('El nombre y la ruta del ejecutable son obligatorios');
      return;
    }
    setAdding(true);
    try {
      const year = releaseYear ? parseInt(releaseYear, 10) : null;
      await invokeCmd('add_custom_game', {
        name: name.trim(),
        platform: 'custom',
        executablePath: executablePath.trim(),
        arguments: args.trim() ? args.trim() : null,
        saga: saga.trim() ? saga.trim() : null,
        console: consoleName.trim() ? consoleName.trim() : 'PC',
        releaseYear: isNaN(year as number) ? null : year,
        coverPath: coverPath.trim() ? coverPath.trim() : null,
      });
      onAdded();
      onClose();
    } catch (err) {
      alert(`Error al agregar juego: ${err}`);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-xl border border-gray-700 bg-atlas-panel p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 pb-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-neon-cyan" />
            <h3 className="text-lg font-bold uppercase tracking-wider text-white">
              Añadir Juego Manual
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
              Nombre del Juego *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Super Mario 64"
              className="atlas-input mt-1 w-full text-sm"
            />
          </div>

          <div>
            <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
              Ruta del Ejecutable / ROM *
            </label>
            <input
              type="text"
              value={executablePath}
              onChange={(e) => setExecutablePath(e.target.value)}
              placeholder="C:\Juegos\game.exe o ruta a la ROM"
              className="atlas-input mt-1 w-full text-xs font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Saga / Franquicia
              </label>
              <input
                type="text"
                value={saga}
                onChange={(e) => setSaga(e.target.value)}
                placeholder="Super Mario"
                className="atlas-input mt-1 w-full text-sm"
              />
            </div>
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Consola
              </label>
              <input
                type="text"
                value={consoleName}
                onChange={(e) => setConsoleName(e.target.value)}
                placeholder="PC, N64, PS2..."
                className="atlas-input mt-1 w-full text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Año de Lanzamiento
              </label>
              <input
                type="number"
                value={releaseYear}
                onChange={(e) => setReleaseYear(e.target.value)}
                placeholder="1996"
                className="atlas-input mt-1 w-full text-sm"
              />
            </div>
            <div>
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Argumentos CLI
              </label>
              <input
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-fullscreen"
                className="atlas-input mt-1 w-full text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
              Carátula (URL web de imagen)
            </label>
            <input
              type="text"
              value={coverPath}
              onChange={(e) => setCoverPath(e.target.value)}
              placeholder="https://..."
              className="atlas-input mt-1 w-full text-xs"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-700 px-4 py-2 font-mono text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding}
            className="atlas-btn-cyan px-5 py-2 font-mono text-xs disabled:opacity-50"
          >
            {adding ? 'Añadiendo...' : 'Añadir a Biblioteca'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------- Aplicación --------------------------- */

export function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('INICIALIZANDO...');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('catalog');
  const [activePlatform, setActivePlatform] = useState<string | null>(null);
  const [activeSaga, setActiveSaga] = useState<string | null>(null);

  // Modales
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const sagas = useMemo(() => groupBySaga(games), [games]);

  const platforms = useMemo(() => {
    const map = new Map<string, number>();
    for (const game of games) {
      map.set(game.platform, (map.get(game.platform) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([id, count]) => ({
        id,
        name: PLATFORM_LABELS[id] || id.toUpperCase(),
        color: PLATFORM_COLORS[id] || '#ffffff',
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [games]);

  const filteredGames = useMemo(() => {
    const query = search.trim().toLowerCase();
    return games.filter((game) => {
      const matchesQuery =
        !query ||
        game.name.toLowerCase().includes(query) ||
        (game.saga || '').toLowerCase().includes(query);
      const matchesPlatform = !activePlatform || game.platform === activePlatform;
      const matchesSaga = !activeSaga || (game.saga || 'Sin saga') === activeSaga;
      return matchesQuery && matchesPlatform && matchesSaga;
    });
  }, [games, search, activePlatform, activeSaga]);

  const filteredSagas = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sagas
      .map((saga) => ({
        ...saga,
        games: saga.games.filter((game) => {
          const matchesPlatform = !activePlatform || game.platform === activePlatform;
          const matchesQuery = !query || game.name.toLowerCase().includes(query);
          return matchesPlatform && matchesQuery;
        }),
      }))
      .filter((saga) => saga.games.length > 0);
  }, [sagas, search, activePlatform]);

  useEffect(() => {
    void bootstrap(true);
  }, []);

  async function bootstrap(scanOnStart: boolean) {
    setLoading(true);
    try {
      setStatus('INICIALIZANDO BASE DE DATOS...');
      await invokeCmd<string>('init_database');

      let scanned = 0;
      let details = '';
      if (scanOnStart) {
        setStatus('ESCANEANDO STEAM, EPIC, GOG Y ESCRITORIO...');
        const result = await invokeCmd<ScanResult>('scan_libraries');
        scanned = result.games_found;
        details = result.platforms_scanned.join(' · ');
        if (result.errors.length > 0) {
          console.warn('Errores de escaneo:', result.errors);
        }
      }

      const list = await invokeCmd<Game[]>('list_games');
      setGames(list);
      setStatus(
        scanOnStart
          ? `${scanned} DETECTADOS · ${list.length} EN BIBLIOTECA${details ? ` · ${details}` : ''}`
          : `${list.length} JUEGOS EN BIBLIOTECA`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(error);
      setStatus(`ERROR: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleLaunch(game: Game) {
    if (game.is_emulated && game.rom_iso_path) {
      setStatus(`${game.name}: emulador no configurado todavía`);
      return;
    }

    if (!game.executable_path) {
      setStatus(`${game.name}: no se encontró la ruta del ejecutable`);
      return;
    }

    setStatus(`LANZANDO ${game.name.toUpperCase()}...`);
    try {
      await invokeCmd('launch_game', {
        gameId: game.id,
        executable: game.executable_path,
        arguments: game.arguments || null,
        workingDirectory: null,
      });
      setStatus(`${game.name.toUpperCase()} EN EJECUCIÓN`);

      // Refrescar lista de juegos para actualizar último jugado y tiempo
      setTimeout(async () => {
        const refreshed = await invokeCmd<Game[]>('list_games');
        setGames(refreshed);
      }, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`ERROR AL LANZAR: ${message}`);
    }
  }

  const platformOptions = [
    { id: null, name: 'TODOS', color: '#ffffff', count: games.length },
    ...platforms,
  ];

  return (
    <div className="flex min-h-screen flex-col bg-atlas-dark font-pixel text-white">
      {/* Barra superior */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-black/70 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/icon.png" alt="Atlas Logo" className="h-9 w-9 rounded-md object-contain" />
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-[0.2em] text-neon-pink">
                Atlas Launcher
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
                Sostiene tu mundo de videojuegos
              </p>
            </div>
            <span className="mt-1 self-start font-mono text-[10px] text-gray-600">v1.0.0</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar juegos o sagas..."
                className="atlas-input w-64 text-xs"
              />
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-500" />
            </div>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 rounded border border-gray-700 bg-gray-900/80 px-3 py-2 font-mono text-xs text-gray-300 hover:border-gray-500 hover:text-white"
              title="Añadir juego manualmente"
            >
              <Plus className="h-4 w-4 text-neon-cyan" />
              Añadir
            </button>

            <button
              type="button"
              onClick={() => void bootstrap(true)}
              disabled={loading}
              className="atlas-btn-cyan flex items-center px-4 py-2 text-xs disabled:opacity-50"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              ESCANEAR
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Barra lateral */}
        <aside className="w-64 shrink-0 border-r border-gray-800 bg-atlas-panel">
          <div className="flex h-full flex-col p-5">
            <h2 className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neon-cyan">
              Biblioteca
            </h2>
            <div className="space-y-1">
              {platformOptions.map((platform) => {
                const active = activePlatform === platform.id;
                return (
                  <button
                    key={platform.id ?? 'all'}
                    type="button"
                    onClick={() => {
                      setActivePlatform(platform.id);
                      setActiveSaga(null);
                    }}
                    className={`flex w-full items-center justify-between rounded px-3 py-2 font-mono text-xs transition-colors ${
                      active
                        ? 'bg-neon-pink text-black font-bold'
                        : 'text-gray-400 hover:bg-gray-800/60 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: platform.color }}
                      />
                      <span>{platform.name}</span>
                    </div>
                    <span className={active ? 'text-black/70' : 'text-gray-600'}>
                      {platform.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <h2 className="mb-3 mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neon-cyan">
              Sagas y Franquicias
            </h2>
            <div className="scrollbar-hide flex-1 space-y-1 overflow-y-auto pr-1">
              {sagas.map((saga) => {
                const active = activeSaga === saga.name;
                return (
                  <button
                    key={saga.name}
                    type="button"
                    onClick={() => {
                      setActiveSaga(active ? null : saga.name);
                    }}
                    className={`flex w-full items-center justify-between rounded px-3 py-1.5 font-mono text-xs transition-colors ${
                      active
                        ? 'bg-neon-cyan text-black'
                        : 'text-gray-400 hover:bg-gray-800/60 hover:text-white'
                    }`}
                  >
                    <span className="truncate">{saga.name}</span>
                    <span className={active ? 'text-black/70' : 'text-gray-600'}>
                      {saga.games.length}
                    </span>
                  </button>
                );
              })}
              {sagas.length === 0 && (
                <p className="px-3 font-mono text-[10px] text-gray-600">Sin sagas detectadas</p>
              )}
            </div>

            <div className="mt-auto border-t border-gray-800 pt-4">
              <div className="flex items-start gap-2 font-mono text-[10px] leading-relaxed text-gray-500">
                <Cpu className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{status}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Contenido */}
        <main className="scrollbar-hide flex-1 overflow-y-auto bg-black/20 p-6">
          <div className="mx-auto max-w-[1600px]">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold uppercase tracking-wider text-white">
                  {activeSaga
                    ? activeSaga
                    : view === 'sagas'
                      ? 'Colecciones de sagas'
                      : view === 'list'
                        ? 'Biblioteca'
                        : 'Catálogo'}
                </h2>
                <p className="mt-1 font-mono text-xs text-gray-500">
                  {filteredGames.length} juego{filteredGames.length === 1 ? '' : 's'}
                  {activeSaga ? ` · saga ${activeSaga}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView('catalog')}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                    view === 'catalog'
                      ? 'border-neon-pink bg-neon-pink text-black'
                      : 'border-gray-700 text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  <LayoutGrid className="h-4 w-4" /> Catálogo
                </button>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                    view === 'list'
                      ? 'border-neon-cyan bg-neon-cyan text-black'
                      : 'border-gray-700 text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  <ListIcon className="h-4 w-4" /> Lista
                </button>
                <button
                  type="button"
                  onClick={() => setView('sagas')}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                    view === 'sagas'
                      ? 'border-neon-pink bg-neon-pink text-black'
                      : 'border-gray-700 text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  <BookOpen className="h-4 w-4" /> Sagas
                </button>
              </div>
            </div>

            {/* Vistas */}
            {view === 'catalog' ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
                {filteredGames.map((game) => {
                  const accent = PLATFORM_COLORS[game.platform] || '#ffffff';
                  return (
                    <div
                      key={game.id}
                      className="group relative flex flex-col justify-between overflow-hidden rounded-lg border border-gray-800 bg-atlas-panel transition-all hover:-translate-y-1 hover:border-gray-600 hover:shadow-xl"
                    >
                      <button
                        type="button"
                        onClick={() => handleLaunch(game)}
                        className="text-left focus:outline-none"
                      >
                        <Poster game={game} />
                        <div className="p-3">
                          <h3 className="line-clamp-1 text-xs font-bold text-white group-hover:text-neon-pink">
                            {game.name}
                          </h3>
                          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-gray-500">
                            <span style={{ color: accent }}>
                              {PLATFORM_LABELS[game.platform] || game.platform}
                            </span>
                            <span>{game.release_year ?? '—'}</span>
                          </div>
                          {game.play_time_minutes > 0 && (
                            <p className="mt-1 font-mono text-[9px] text-gray-400">
                              Jugado: {formatPlaytime(game.play_time_minutes)}
                            </p>
                          )}
                        </div>
                      </button>

                      {/* Botón flotante para editar */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGame(game);
                        }}
                        className="absolute right-2 top-2 rounded-md bg-black/70 p-1.5 text-gray-300 opacity-0 backdrop-blur transition-opacity hover:bg-black hover:text-white group-hover:opacity-100"
                        title="Editar metadatos / argumentos"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : view === 'list' ? (
              <List
                height={700}
                itemCount={filteredGames.length}
                itemSize={132}
                width="100%"
                className="scrollbar-hide"
              >
                {({ index, style }) => {
                  const game = filteredGames[index];
                  const accent = PLATFORM_COLORS[game.platform] || '#ffffff';
                  return (
                    <div style={style} className="pr-2">
                      <div className="atlas-card flex h-[120px] w-full items-center gap-4 p-3 text-left hover:border-neon-pink">
                        <div className="w-[72px] shrink-0">
                          <Poster game={game} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-bold text-white">{game.name}</h3>
                          <p className="truncate font-mono text-[11px] text-gray-400">
                            {PLATFORM_LABELS[game.platform] || game.platform.toUpperCase()} ·{' '}
                            {game.saga || 'Sin saga'}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded border border-gray-700 px-2 py-0.5 font-mono text-[10px] text-gray-300">
                              {game.release_year ?? '—'}
                            </span>
                            <span className="rounded border border-gray-700 px-2 py-0.5 font-mono text-[10px] text-gray-300">
                              {game.console || 'PC'}
                            </span>
                            {game.play_time_minutes > 0 && (
                              <span className="rounded border border-gray-700 px-2 py-0.5 font-mono text-[10px] text-neon-cyan">
                                {formatPlaytime(game.play_time_minutes)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingGame(game)}
                            className="rounded border border-gray-700 p-2 text-gray-400 hover:border-gray-500 hover:text-white"
                            title="Editar"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLaunch(game)}
                            className="flex items-center rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-wider"
                            style={{ color: accent, borderColor: accent }}
                          >
                            <Play className="mr-1 h-3 w-3" /> Jugar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </List>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {filteredSagas.map((saga) => (
                  <section key={saga.name} className="atlas-card p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-neon-cyan" />
                      <h3 className="text-lg font-bold text-white">{saga.name}</h3>
                      <span className="ml-auto font-mono text-[11px] text-gray-500">
                        {saga.games.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {saga.games.map((game) => (
                        <div key={game.id} className="group relative">
                          <button
                            type="button"
                            onClick={() => handleLaunch(game)}
                            className="w-full focus:outline-none"
                            title={`${game.name} (${game.release_year ?? '—'})`}
                          >
                            <Poster game={game} />
                            <p className="mt-1 line-clamp-1 text-[10px] text-gray-300">
                              {game.name}
                            </p>
                            <p className="font-mono text-[9px] text-gray-500">
                              {game.release_year ?? '—'}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingGame(game);
                            }}
                            className="absolute right-1 top-1 rounded bg-black/80 p-1 text-gray-300 opacity-0 group-hover:opacity-100"
                            title="Editar"
                          >
                            <Edit3 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modales */}
      <EditGameModal
        isOpen={Boolean(editingGame)}
        game={editingGame}
        onClose={() => setEditingGame(null)}
        onSave={(updated) => {
          setGames((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
        }}
        onDelete={(id) => {
          setGames((prev) => prev.filter((g) => g.id !== id));
        }}
      />

      <AddGameModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdded={() => {
          void bootstrap(false);
        }}
      />
    </div>
  );
}

export default App;
