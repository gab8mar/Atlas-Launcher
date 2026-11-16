import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import {
  BookOpen,
  CheckCircle2,
  Cpu,
  Download,
  Edit3,
  Gamepad2,
  Globe,
  ImageDown,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Sun,
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

interface UpdateInfo {
  available: boolean;
  current_version: string;
  latest_version: string;
  release_name: string | null;
  release_notes: string | null;
  published_at: string | null;
  html_url: string | null;
  asset_name: string | null;
  download_url: string | null;
  asset_size: number | null;
  digest: string | null;
}

interface UpdateProgress {
  downloaded: number;
  total: number;
  percent: number;
}

interface MetadataSettings {
  igdb_client_id: string | null;
  igdb_configured: boolean;
  steamgriddb_configured: boolean;
  credentials_path: string;
}

interface MetadataResult {
  game_id: number;
  source: string | null;
  release_year: number | null;
  console: string | null;
  genre: string | null;
  rating: number | null;
  cover_path: string | null;
  banner_path: string | null;
  logo_path: string | null;
  warnings: string[];
}

interface MetadataProgress {
  processed: number;
  total: number;
  game_id: number;
  name: string;
  cover_path: string | null;
  error: string | null;
}

interface MetadataBulkResult {
  total: number;
  updated: number;
  failed: number;
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
      <div className="flex items-center justify-between text-gray-200">
        <Gamepad2 className="h-5 w-5 text-gray-200" />
        <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-gray-200">
          {game.console || 'PC'}
        </span>
      </div>

      <div>
        <p className="line-clamp-3 text-xs font-bold leading-tight text-white drop-shadow-md">
          {game.name}
        </p>
        {game.release_year && (
          <p className="mt-1 font-mono text-[10px] text-gray-200">{game.release_year}</p>
        )}
      </div>

      <div className="font-mono text-[9px] font-semibold uppercase tracking-widest text-gray-200">
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
  onMetadataFetched: (id: number, changes: Partial<Game>) => void;
}

function EditGameModal({
  game,
  isOpen,
  onClose,
  onSave,
  onDelete,
  onMetadataFetched,
}: EditModalProps) {
  const [name, setName] = useState('');
  const [saga, setSaga] = useState('');
  const [releaseYear, setReleaseYear] = useState<string>('');
  const [consoleName, setConsoleName] = useState('');
  const [executablePath, setExecutablePath] = useState('');
  const [args, setArgs] = useState('');
  const [coverPath, setCoverPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [metaMessage, setMetaMessage] = useState<string | null>(null);
  const [metaError, setMetaError] = useState(false);

  useEffect(() => {
    if (game) {
      setName(game.name);
      setSaga(game.saga || '');
      setReleaseYear(game.release_year ? String(game.release_year) : '');
      setConsoleName(game.console || 'PC');
      setExecutablePath(game.executable_path || '');
      setArgs(game.arguments || '');
      setCoverPath(game.cover_path || '');
      setMetaMessage(null);
      setMetaError(false);
    }
  }, [game]);

  if (!isOpen || !game) return null;

  async function handleFetchMetadata() {
    if (!game) return;
    setFetchingMeta(true);
    setMetaMessage(null);
    setMetaError(false);
    try {
      const result = await invokeCmd<MetadataResult>('fetch_game_metadata', {
        gameId: game.id,
      });

      if (result.release_year) setReleaseYear(String(result.release_year));
      if (result.console) setConsoleName(result.console);
      if (result.cover_path) setCoverPath(result.cover_path);

      onMetadataFetched(game.id, {
        cover_path: result.cover_path ?? game.cover_path,
        release_year: result.release_year ?? game.release_year,
        console: result.console ?? game.console,
      });

      const details = [
        result.source ? `fuente ${result.source.toUpperCase()}` : null,
        result.genre ?? null,
        result.rating ? `${result.rating.toFixed(1)}/100` : null,
      ].filter(Boolean);

      setMetaMessage(
        details.length > 0
          ? `Metadatos encontrados · ${details.join(' · ')}`
          : 'Metadatos encontrados',
      );
      if (result.warnings.length > 0) {
        console.warn('Avisos de metadatos:', result.warnings);
      }
    } catch (err) {
      setMetaError(true);
      setMetaMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingMeta(false);
    }
  }

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
            <div className="flex items-center justify-between gap-2">
              <label className="block font-mono text-[11px] uppercase tracking-wider text-gray-400">
                Carátula (URL web o ruta local de imagen)
              </label>
              <button
                type="button"
                onClick={() => void handleFetchMetadata()}
                disabled={fetchingMeta}
                className="flex items-center gap-1 rounded border border-neon-cyan/50 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-50"
                title="Buscar metadatos y portada en IGDB / SteamGridDB"
              >
                {fetchingMeta ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {fetchingMeta ? 'Buscando...' : 'Buscar automático'}
              </button>
            </div>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={coverPath}
                onChange={(e) => setCoverPath(e.target.value)}
                placeholder="https://... o C:\caratula.png"
                className="atlas-input flex-1 text-xs"
              />
            </div>
            {metaMessage && (
              <p
                className={`mt-2 font-mono text-[10px] leading-relaxed ${
                  metaError ? 'text-red-400' : 'text-neon-cyan'
                }`}
              >
                {metaMessage}
              </p>
            )}
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

/* -------------------------- Modal Actualización ------------------ */

interface UpdateModalProps {
  isOpen: boolean;
  info: UpdateInfo | null;
  error: string | null;
  installing: boolean;
  progress: number;
  onClose: () => void;
  onInstall: () => void;
  onRetry: () => void;
}

/* -------------------------- Modal Ajustes ------------------------ */

interface MetadataSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function MetadataSettingsModal({ isOpen, onClose }: MetadataSettingsModalProps) {
  const [igdbClientId, setIgdbClientId] = useState('');
  const [igdbClientSecret, setIgdbClientSecret] = useState('');
  const [steamgriddbApiKey, setSteamgriddbApiKey] = useState('');
  const [settings, setSettings] = useState<MetadataSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setMessage(null);
    setError(false);
    setIgdbClientSecret('');
    setSteamgriddbApiKey('');
    setLoading(true);

    void invokeCmd<MetadataSettings>('get_metadata_settings')
      .then((value) => {
        setSettings(value);
        setIgdbClientId(value.igdb_client_id || '');
      })
      .catch((err) => {
        setError(true);
        setMessage(err instanceof Error ? err.message : String(err));
        setSettings(null);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setError(false);
    try {
      const value = await invokeCmd<MetadataSettings>('save_metadata_settings', {
        igdbClientId: igdbClientId.trim() || null,
        igdbClientSecret: igdbClientSecret.trim() || null,
        steamgriddbApiKey: steamgriddbApiKey.trim() || null,
        clear: false,
      });
      setSettings(value);
      setIgdbClientSecret('');
      setSteamgriddbApiKey('');
      setMessage('Claves guardadas. Las conexiones con las APIs ahora descargan metadatos automáticamente en segundo plano.');
      void bootstrap(false);
    } catch (err) {
      setError(true);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm('¿Borrar las claves de IGDB y SteamGridDB guardadas en este equipo?')) return;
    setSaving(true);
    setMessage(null);
    setError(false);
    try {
      const value = await invokeCmd<MetadataSettings>('save_metadata_settings', {
        igdbClientId: null,
        igdbClientSecret: null,
        steamgriddbApiKey: null,
        clear: true,
      });
      setSettings(value);
      setIgdbClientId('');
      setIgdbClientSecret('');
      setSteamgriddbApiKey('');
      setMessage('Claves eliminadas.');
    } catch (err) {
      setError(true);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-xl border border-gray-700 bg-atlas-panel p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 pb-4">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-neon-cyan" />
            <h3 className="text-lg font-bold uppercase tracking-wider text-white">
              Ajustes de metadatos
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

        <p className="mt-4 font-mono text-[10px] leading-relaxed text-gray-300">
          IGDB aporta año, género, nota y carátula; SteamGridDB aporta carátula vertical, banner
          y logo. Las claves se guardan solo en este equipo. Deja un campo vacío para conservar
          la clave ya guardada.
        </p>

        {loading ? (
          <div className="mt-6 flex items-center gap-2 font-mono text-xs text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando ajustes...
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-gray-400">
                  IGDB Client ID
                </label>
                <input
                  type="text"
                  value={igdbClientId}
                  onChange={(e) => setIgdbClientId(e.target.value)}
                  placeholder="xxxxxxxxxxxxxxxx"
                  className="atlas-input mt-1 w-full text-xs"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-gray-400">
                  IGDB Client Secret
                </label>
                <input
                  type="password"
                  value={igdbClientSecret}
                  onChange={(e) => setIgdbClientSecret(e.target.value)}
                  placeholder={settings?.igdb_configured ? '•••••• (guardado)' : 'sin configurar'}
                  className="atlas-input mt-1 w-full text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-gray-400">
                SteamGridDB API Key
              </label>
              <input
                type="password"
                value={steamgriddbApiKey}
                onChange={(e) => setSteamgriddbApiKey(e.target.value)}
                placeholder={settings?.steamgriddb_configured ? '•••••• (guardada)' : 'sin configurar'}
                className="atlas-input mt-1 w-full text-xs"
              />
            </div>

            <div className="flex flex-wrap gap-3 font-mono text-[10px] text-gray-300">
              <span className={settings?.igdb_configured ? 'text-neon-cyan' : ''}>
                IGDB: {settings?.igdb_configured ? 'configurado' : 'pendiente'}
              </span>
              <span className={settings?.steamgriddb_configured ? 'text-neon-cyan' : ''}>
                SteamGridDB: {settings?.steamgriddb_configured ? 'configurado' : 'pendiente'}
              </span>
            </div>

            <div className="rounded border border-gray-800 bg-black/30 p-3 font-mono text-[9px] leading-relaxed text-gray-300">
              <p>IGDB: dev.twitch.tv/console/apps · api-docs.igdb.com</p>
              <p>SteamGridDB: steamgriddb.com/profile/preferences/api</p>
              <p className="mt-1 break-all text-gray-400">{settings?.credentials_path}</p>
            </div>
          </div>
        )}

        {message && (
          <p
            className={`mt-4 rounded border p-3 font-mono text-[10px] leading-relaxed ${
              error
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan'
            }`}
          >
            {message}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-gray-800 pt-4">
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={saving}
            className="rounded px-3 py-1.5 font-mono text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
          >
            Borrar claves
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-700 px-4 py-2 font-mono text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="atlas-btn-cyan flex items-center px-5 py-2 font-mono text-xs disabled:opacity-50"
            >
              {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Guardar claves
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GeneralSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'es' | 'en';
  setLang: (l: 'es' | 'en') => void;
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onResizeWindow: (w: number, h: number) => void;
  onOpenMetadataSettings: () => void;
  onCheckUpdate: () => void;
  checkingUpdate: boolean;
  updateAvailable?: boolean;
}

function GeneralSettingsModal({
  isOpen,
  onClose,
  lang,
  setLang,
  theme,
  setTheme,
  isFullscreen,
  onToggleFullscreen,
  onResizeWindow,
  onOpenMetadataSettings,
  onCheckUpdate,
  checkingUpdate,
  updateAvailable,
}: GeneralSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-atlas-panel p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 pb-4">
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-neon-pink" />
            <h3 className="text-lg font-bold uppercase tracking-wider text-white">
              {lang === 'es' ? 'Configuración General' : 'General Settings'}
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

        <div className="mt-4 space-y-5">
          {/* Idioma */}
          <div>
            <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-neon-cyan">
              <Globe className="h-4 w-4" />
              {lang === 'es' ? 'Idioma de la Interfaz' : 'Interface Language'}
            </label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLang('es')}
                className={`rounded border px-4 py-2 font-mono text-xs font-bold transition-colors ${
                  lang === 'es'
                    ? 'border-neon-pink bg-neon-pink text-black'
                    : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-gray-500 hover:text-white'
                }`}
              >
                Español (ES)
              </button>
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`rounded border px-4 py-2 font-mono text-xs font-bold transition-colors ${
                  lang === 'en'
                    ? 'border-neon-pink bg-neon-pink text-black'
                    : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-gray-500 hover:text-white'
                }`}
              >
                English (EN)
              </button>
            </div>
          </div>

          {/* Tema */}
          <div>
            <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-neon-cyan">
              {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {lang === 'es' ? 'Tema Visual' : 'Visual Theme'}
            </label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-2 rounded border px-4 py-2 font-mono text-xs font-bold transition-colors ${
                  theme === 'dark'
                    ? 'border-neon-cyan bg-neon-cyan text-black'
                    : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-gray-500 hover:text-white'
                }`}
              >
                <Moon className="h-3.5 w-3.5" />
                {lang === 'es' ? 'Modo Oscuro Cyber' : 'Cyber Dark'}
              </button>
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-2 rounded border px-4 py-2 font-mono text-xs font-bold transition-colors ${
                  theme === 'light'
                    ? 'border-neon-cyan bg-neon-cyan text-black'
                    : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-gray-500 hover:text-white'
                }`}
              >
                <Sun className="h-3.5 w-3.5" />
                {lang === 'es' ? 'Modo Claro Neón' : 'Neon Light'}
              </button>
            </div>
          </div>

          {/* Tamaño de Ventana y Pantalla Completa */}
          <div>
            <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-neon-cyan">
              <Monitor className="h-4 w-4" />
              {lang === 'es' ? 'Tamaño de Ventana y Pantalla' : 'Window Size & Display'}
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onResizeWindow(1280, 760)}
                className="rounded border border-gray-700 bg-gray-900/80 px-2 py-2 font-mono text-[11px] text-gray-300 hover:border-neon-pink hover:text-white"
              >
                1280 × 760
              </button>
              <button
                type="button"
                onClick={() => onResizeWindow(1440, 840)}
                className="rounded border border-gray-700 bg-gray-900/80 px-2 py-2 font-mono text-[11px] text-gray-300 hover:border-neon-pink hover:text-white"
              >
                1440 × 840
              </button>
              <button
                type="button"
                onClick={() => onResizeWindow(1600, 840)}
                className="rounded border border-gray-700 bg-gray-900/80 px-2 py-2 font-mono text-[11px] text-gray-300 hover:border-neon-pink hover:text-white"
              >
                1600 × 840
              </button>
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={onToggleFullscreen}
                className={`flex w-full items-center justify-center gap-2 rounded border px-4 py-2.5 font-mono text-xs font-bold transition-colors ${
                  isFullscreen
                    ? 'border-neon-pink bg-neon-pink/20 text-neon-pink hover:bg-neon-pink/30'
                    : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-neon-cyan hover:text-white'
                }`}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4 text-neon-cyan" />}
                {isFullscreen
                  ? lang === 'es' ? 'Salir del Modo Big Picture (F11 / Esc)' : 'Exit Big Picture (F11 / Esc)'
                  : lang === 'es' ? 'Activar Modo Big Picture (Pantalla Completa F11)' : 'Enter Big Picture (Fullscreen F11)'}
              </button>
            </div>
          </div>

          {/* Actualizaciones del Sistema */}
          <div className="border-t border-gray-800 pt-3">
            <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-neon-cyan">
              <Download className="h-4 w-4" />
              {lang === 'es' ? 'Actualizaciones de la Aplicación' : 'Application Updates'}
            </label>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCheckUpdate();
                }}
                disabled={checkingUpdate}
                className={`flex w-full items-center justify-center gap-2 rounded border px-4 py-2.5 font-mono text-xs font-bold transition-colors disabled:opacity-50 ${
                  updateAvailable
                    ? 'border-neon-pink bg-neon-pink/15 text-neon-pink hover:bg-neon-pink/25'
                    : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-neon-cyan hover:text-white'
                }`}
              >
                <Download className={`h-4 w-4 ${checkingUpdate ? 'animate-bounce' : ''}`} />
                {checkingUpdate
                  ? lang === 'es' ? 'BUSCANDO ACTUALIZACIONES...' : 'CHECKING FOR UPDATES...'
                  : updateAvailable
                    ? lang === 'es' ? '¡NUEVA VERSIÓN DISPONIBLE! ACTUALIZAR' : 'NEW VERSION AVAILABLE! UPDATE'
                    : lang === 'es' ? 'BUSCAR ACTUALIZACIONES DE ATLAS' : 'CHECK FOR ATLAS UPDATES'}
              </button>
            </div>
          </div>

          {/* Acceso a APIs de Metadatos */}
          <div className="border-t border-gray-800 pt-3">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenMetadataSettings();
              }}
              className="flex w-full items-center justify-between rounded border border-gray-700 bg-gray-900/60 px-4 py-2.5 font-mono text-xs text-gray-300 hover:border-neon-cyan hover:text-white"
            >
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-neon-cyan" />
                <span>{lang === 'es' ? 'Ajustes avanzados de APIs (IGDB / SteamGridDB)' : 'Advanced APIs (IGDB / SteamGridDB)'}</span>
              </div>
              <span className="text-neon-cyan">→</span>
            </button>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-gray-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="atlas-btn-cyan px-6 py-2 font-mono text-xs"
          >
            {lang === 'es' ? 'Listo' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdateModal({
  isOpen,
  info,
  error,
  installing,
  progress,
  onClose,
  onInstall,
  onRetry,
}: UpdateModalProps) {
  if (!isOpen) return null;

  const canInstall = Boolean(info?.available && info.download_url && info.asset_name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-xl border border-gray-700 bg-atlas-panel p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 pb-4">
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-neon-cyan" />
            <h3 className="text-lg font-bold uppercase tracking-wider text-white">
              Actualización de Atlas Launcher
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={installing}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {error && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {error}
            </div>
          )}

          {!error && !info && (
            <p className="font-mono text-sm text-gray-400">Consultando GitHub Releases...</p>
          )}

          {info && !info.available && (
            <div className="flex items-start gap-3 rounded border border-green-500/30 bg-green-500/10 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
              <div>
                <p className="text-sm font-bold text-white">Estás al día</p>
                <p className="mt-1 font-mono text-xs text-gray-400">
                  Atlas Launcher v{info.current_version} es la última versión disponible.
                </p>
              </div>
            </div>
          )}

          {info && info.available && (
            <>
              <div className="flex items-center justify-between rounded border border-gray-800 bg-black/30 p-3 font-mono text-xs">
                <span className="text-gray-400">
                  Versión actual: <span className="text-white">v{info.current_version}</span>
                </span>
                <span className="text-gray-400">
                  Nueva versión: <span className="text-neon-pink">v{info.latest_version}</span>
                </span>
              </div>

              {info.release_notes && (
                <div>
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-gray-400">
                    Notas del release
                  </p>
                  <pre className="scrollbar-hide max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-gray-800 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-gray-300">
                    {info.release_notes}
                  </pre>
                </div>
              )}

              {!info.download_url && (
                <p className="font-mono text-xs text-yellow-400">
                  El release no incluye un instalador compatible (.exe/.msi). Descárgalo manualmente
                  desde GitHub.
                </p>
              )}

              {installing && (
                <div>
                  <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-gray-400">
                    <span>Descargando actualización...</span>
                    <span className="text-neon-cyan">{progress}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
                    <div
                      className="h-full rounded-full bg-neon-cyan transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-gray-300">
                    La aplicación se cerrará para completar la instalación.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-800 pt-4">
          {error ? (
            <button
              type="button"
              onClick={onRetry}
              className="atlas-btn-cyan px-5 py-2 font-mono text-xs"
            >
              Reintentar
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={installing}
                className="rounded border border-gray-700 px-4 py-2 font-mono text-xs text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
              >
                {info?.available ? 'Más tarde' : 'Cerrar'}
              </button>
              {canInstall && (
                <button
                  type="button"
                  onClick={onInstall}
                  disabled={installing}
                  className="atlas-btn-cyan px-5 py-2 font-mono text-xs disabled:opacity-50"
                >
                  {installing ? 'Instalando...' : 'Descargar e instalar'}
                </button>
              )}
            </>
          )}
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

  // Actualizaciones
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Metadatos y portadas
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [fetchingCovers, setFetchingCovers] = useState(false);
  const [metadataProgress, setMetadataProgress] = useState<MetadataProgress | null>(null);

  // Ventana / Modo Big Picture
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Ajustes de Interfaz
  const [isGeneralSettingsOpen, setIsGeneralSettingsOpen] = useState(false);
  const [lang, setLang] = useState<'es' | 'en'>(() => {
    return (localStorage.getItem('atlas_lang') as 'es' | 'en') || 'es';
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('atlas_theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('atlas_lang', lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('atlas_theme', theme);
  }, [theme]);

  async function handleResizeWindow(width: number, height: number) {
    try {
      await invokeCmd('set_window_size', { width, height });
      setStatus(`TAMAÑO DE VENTANA AJUSTADO A ${width}x${height}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`ERROR AJUSTANDO TAMAÑO: ${msg}`);
    }
  }

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

  useEffect(() => {
    void getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => {
        /* La versión mostrada es solo informativa. */
      });

    let unlisten: (() => void) | undefined;
    void listen<UpdateProgress>('atlas-update-progress', (event) => {
      setUpdateProgress(Math.round(event.payload.percent));
    })
      .then((stop) => {
        unlisten = stop;
      })
      .catch(() => {
        /* Sin listener el modal sigue funcionando sin barra de progreso. */
      });

    let unlistenMetadata: (() => void) | undefined;
    void listen<MetadataProgress>('atlas-metadata-progress', (event) => {
      const progress = event.payload;
      setMetadataProgress(progress);
      setStatus(
        `DESCARGANDO METADATOS ${progress.processed}/${progress.total} · ${progress.name}${
          progress.error ? ' · error' : ''
        }`,
      );

      // Si se obtuvo portada para un juego, actualizarlo en el estado de la biblioteca en vivo
      if (progress.cover_path) {
        setGames((prev) =>
          prev.map((g) =>
            g.id === progress.game_id
              ? { ...g, cover_path: progress.cover_path ?? g.cover_path }
              : g,
          ),
        );
      }
    })
      .then((stop) => {
        unlistenMetadata = stop;
      })
      .catch(() => {
        /* La descarga masiva también funciona sin barra de progreso. */
      });

    return () => {
      unlisten?.();
      unlistenMetadata?.();
    };
  }, []);

  // Cambia entre modo ventana y modo Big Picture (pantalla completa).
  async function applyFullscreen(enabled: boolean) {
    try {
      const state = await invokeCmd<boolean>('set_fullscreen', { enabled });
      setIsFullscreen(state);
      setStatus(
        state
          ? 'MODO BIG PICTURE · F11 O ESC PARA VOLVER'
          : 'MODO VENTANA · F11 PARA BIG PICTURE',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`ERROR CAMBIANDO DE MODO: ${message}`);
    }
  }

  // Atajos: F11 alterna Big Picture y Esc vuelve al modo ventana.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'F11') {
        event.preventDefault();
        void applyFullscreen(!isFullscreen);
      } else if (event.key === 'Escape' && isFullscreen) {
        event.preventDefault();
        void applyFullscreen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const info = await invokeCmd<UpdateInfo>('check_update');
      setUpdateInfo(info);
      setIsUpdateModalOpen(true);
      setStatus(
        info.available
          ? `ACTUALIZACIÓN DISPONIBLE: v${info.latest_version}`
          : `ATLAS LAUNCHER v${info.current_version} ESTÁ ACTUALIZADO`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateInfo(null);
      setUpdateError(message);
      setIsUpdateModalOpen(true);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    if (!updateInfo?.download_url || !updateInfo.asset_name) return;

    setInstallingUpdate(true);
    setUpdateError(null);
    setUpdateProgress(0);
    try {
      await invokeCmd<string>('install_update', {
        downloadUrl: updateInfo.download_url,
        assetName: updateInfo.asset_name,
        expectedDigest: updateInfo.digest ?? null,
      });
      setStatus('DESCARGANDO ACTUALIZACIÓN...');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateError(message);
      setInstallingUpdate(false);
    }
  }

  async function handleFetchCovers() {
    setFetchingCovers(true);
    setMetadataProgress(null);
    setStatus('BUSCANDO PORTADAS FALTANTES...');
    try {
      const result = await invokeCmd<MetadataBulkResult>('fetch_missing_covers', { limit: 12 });
      const list = await invokeCmd<Game[]>('list_games');
      setGames(list);

      if (result.total === 0) {
        setStatus('TODAS LAS PORTADAS YA ESTÁN DESCARGADAS');
      } else {
        setStatus(
          `PORTADAS: ${result.updated} ACTUALIZADAS · ${result.failed} CON ERROR${
            result.failed > 0 ? ' (revisa las claves o los nombres)' : ''
          }`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`ERROR DESCARGANDO PORTADAS: ${message}`);
    } finally {
      setFetchingCovers(false);
      setMetadataProgress(null);
    }
  }

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
    <div className={`flex h-screen flex-col overflow-hidden font-pixel transition-colors duration-200 ${
      theme === 'light' ? 'bg-[#181824] text-gray-100' : 'bg-atlas-dark text-white'
    }`}>
      {/* Barra superior */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-black/70 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/icon.png" alt="Atlas Logo" className="h-9 w-9 rounded-md object-contain" />
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-[0.2em] text-neon-pink">
                Atlas Launcher
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-widest text-gray-300">
                Sostiene tu mundo de videojuegos
              </p>
            </div>
            <span className="mt-1 self-start font-mono text-[10px] text-gray-400">
              v{appVersion}
            </span>
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
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-300" />
            </div>

            <button
              type="button"
              onClick={() => setIsGeneralSettingsOpen(true)}
              className="flex items-center gap-1.5 rounded border border-neon-cyan/50 bg-gray-900/80 px-3 py-2 font-mono text-xs text-neon-cyan hover:bg-neon-cyan/20 hover:text-white"
              title={lang === 'es' ? 'Configuración general del Launcher' : 'Launcher general settings'}
            >
              <Settings className="h-4 w-4" />
              {lang === 'es' ? 'CONFIGURACIÓN' : 'SETTINGS'}
            </button>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 rounded border border-gray-700 bg-gray-900/80 px-3 py-2 font-mono text-xs text-gray-300 hover:border-gray-500 hover:text-white"
              title={lang === 'es' ? 'Añadir juego manualmente' : 'Add game manually'}
            >
              <Plus className="h-4 w-4 text-neon-cyan" />
              {lang === 'es' ? 'AÑADIR' : 'ADD'}
            </button>

            <button
              type="button"
              onClick={() => void bootstrap(true)}
              disabled={loading}
              className="atlas-btn-cyan flex items-center px-4 py-2 text-xs disabled:opacity-50"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {lang === 'es' ? 'ESCANEAR' : 'SCAN'}
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Barra lateral */}
        <aside className="scrollbar-hide w-64 shrink-0 overflow-y-auto border-r border-gray-800 bg-atlas-panel">
          <div className="flex min-h-full flex-col p-5">
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
                        : 'text-gray-200 hover:bg-gray-800/80 hover:text-white font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: platform.color }}
                      />
                      <span className="text-gray-100">{platform.name}</span>
                    </div>
                    <span className={active ? 'text-black font-bold' : 'text-gray-400 font-mono text-[11px]'}>
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
                        ? 'bg-neon-cyan text-black font-bold'
                        : 'text-gray-200 hover:bg-gray-800/80 hover:text-white font-medium'
                    }`}
                  >
                    <span className="truncate text-gray-100">{saga.name}</span>
                    <span className={active ? 'text-black font-bold' : 'text-gray-400 font-mono text-[11px]'}>
                      {saga.games.length}
                    </span>
                  </button>
                );
              })}
              {sagas.length === 0 && (
                <p className="px-3 font-mono text-[10px] text-gray-400">Sin sagas detectadas</p>
              )}
            </div>

            <div className="mt-auto border-t border-gray-800 pt-4">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void applyFullscreen(!isFullscreen)}
                  className={`flex w-full items-center justify-center gap-2 rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    isFullscreen
                      ? 'border-[#00ffff] bg-[#00ffff]/15 text-[#00ffff] hover:bg-[#00ffff]/25'
                      : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-gray-500 hover:text-white'
                  }`}
                  title="Pantalla completa sin bordes (F11)"
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5 text-neon-cyan" />
                  )}
                  {isFullscreen ? 'Salir de Big Picture' : 'Modo Big Picture'}
                </button>
                {fetchingCovers && (
                  <div className="flex w-full items-center justify-center gap-2 rounded border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-neon-cyan">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-neon-cyan" />
                    <span>
                      {`Descargando metadatos ${metadataProgress?.processed ?? 0}/${metadataProgress?.total ?? 0}`}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded border border-gray-700 bg-gray-900/80 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-gray-300 hover:border-gray-500 hover:text-white"
                  title="Configurar claves de IGDB y SteamGridDB"
                >
                  <Settings className="h-3.5 w-3.5 text-neon-cyan" />
                  Ajustes de metadatos (APIs)
                </button>
              </div>

              <div className="mt-3 flex items-start gap-2 font-mono text-[10px] leading-relaxed text-gray-300">
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
                <p className="mt-1 font-mono text-xs text-gray-300">
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
                          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-gray-200">
                            <span style={{ color: accent }} className="font-semibold">
                              {PLATFORM_LABELS[game.platform] || game.platform}
                            </span>
                            <span className="text-gray-300 font-medium">{game.release_year ?? '—'}</span>
                          </div>
                          {game.play_time_minutes > 0 && (
                            <p className="mt-1 font-mono text-[9px] text-gray-300">
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
                      <span className="ml-auto font-mono text-[11px] text-gray-300">
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
                            <p className="font-mono text-[9px] text-gray-300">
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
        onMetadataFetched={(id, changes) => {
          setGames((prev) => prev.map((g) => (g.id === id ? { ...g, ...changes } : g)));
        }}
      />

      <AddGameModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdded={() => {
          void bootstrap(false);
        }}
      />

      <MetadataSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      <GeneralSettingsModal
        isOpen={isGeneralSettingsOpen}
        onClose={() => setIsGeneralSettingsOpen(false)}
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => void applyFullscreen(!isFullscreen)}
        onResizeWindow={(w, h) => void handleResizeWindow(w, h)}
        onOpenMetadataSettings={() => setIsSettingsOpen(true)}
        onCheckUpdate={() => void handleCheckUpdate()}
        checkingUpdate={checkingUpdate}
        updateAvailable={updateInfo?.available}
      />

      <UpdateModal
        isOpen={isUpdateModalOpen}
        info={updateInfo}
        error={updateError}
        installing={installingUpdate}
        progress={updateProgress}
        onClose={() => setIsUpdateModalOpen(false)}
        onInstall={() => void handleInstallUpdate()}
        onRetry={() => void handleCheckUpdate()}
      />
    </div>
  );
}

export default App;
