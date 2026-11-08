import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
  BookOpen,
  Cpu,
  FolderOpen,
  Gamepad2,
  LayoutGrid,
  List as ListIcon,
  Play,
  RefreshCw,
  Search,
  Sparkles,
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
  rom_iso_path: string | null;
  is_emulated: boolean;
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
    const key = game.saga || 'Sin saga';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(game);
  }
  return Array.from(map.entries())
    .map(([name, list]) => ({
      name,
      games: [...list].sort((a, b) => (a.release_year || 0) - (b.release_year || 0)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* --------------------------- Componentes ------------------------- */

function Poster({ game, large = false }: { game: Game; large?: boolean }) {
  const source = coverSource(game.cover_path);
  const accent = PLATFORM_COLORS[game.platform] || '#ffffff';
  const label = PLATFORM_LABELS[game.platform] || game.platform.toUpperCase();
  const initial = game.name.trim().charAt(0).toUpperCase();

  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg border border-gray-800 bg-atlas-card ${
        large ? 'aspect-[2/3]' : 'aspect-[2/3]'
      }`}
    >
      {source ? (
        <img
          src={source}
          alt={game.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-2"
          style={{
            background: `radial-gradient(circle at 50% 20%, ${accent}26, #12121c 70%)`,
          }}
        >
          <span className="font-pixel text-6xl" style={{ color: accent }}>
            {initial}
          </span>
          <span className="px-2 text-center font-mono text-[10px] uppercase tracking-widest text-gray-500">
            {game.console || 'PC'}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2">
        <span
          className="inline-block rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
          style={{ color: accent, borderColor: `${accent}66` }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function GameCard({ game, onLaunch }: { game: Game; onLaunch: (game: Game) => void }) {
  return (
    <button
      type="button"
      onClick={() => onLaunch(game)}
      className="group flex flex-col text-left focus:outline-none"
      title={game.executable_path || game.name}
    >
      <Poster game={game} />
      <h3 className="mt-2 line-clamp-2 text-sm font-bold leading-tight text-white group-hover:text-neon-cyan">
        {game.name}
      </h3>
      <p className="mt-1 font-mono text-[11px] text-gray-400">
        {game.release_year ?? '—'} · {game.console || 'PC'}
      </p>
    </button>
  );
}

/* ------------------------------ App ------------------------------ */

function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [view, setView] = useState<View>('catalog');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('INICIANDO...');
  const [loading, setLoading] = useState(true);
  const [activePlatform, setActivePlatform] = useState<string | null>(null);
  const [activeSaga, setActiveSaga] = useState<string | null>(null);

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
        executable: game.executable_path,
        arguments: null,
        workingDirectory: null,
      });
      setStatus(`${game.name.toUpperCase()} EN EJECUCIÓN`);
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
      <header className="sticky top-0 z-50 border-b border-gray-800 bg-black/70 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Gamepad2 className="h-8 w-8 text-neon-pink" />
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-[0.2em] text-neon-pink">
                Atlas Launcher
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
                Organiza y sostiene toda tu biblioteca
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
                    className={`flex w-full items-center justify-between rounded border px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                      active
                        ? 'border-neon-pink bg-neon-pink text-black'
                        : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-gray-800/60'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: platform.color }}
                      />
                      {platform.name}
                    </span>
                    <span className={active ? 'text-black/70' : 'text-gray-600'}>
                      {platform.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <h2 className="mb-3 mt-7 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neon-cyan">
              Sagas
            </h2>
            <div className="scrollbar-hide max-h-80 space-y-1 overflow-y-auto pr-1">
              {sagas.map((saga) => {
                const active = activeSaga === saga.name;
                return (
                  <button
                    key={saga.name}
                    type="button"
                    onClick={() => {
                      setActiveSaga(active ? null : saga.name);
                      setView('catalog');
                    }}
                    className={`flex w-full items-center justify-between rounded px-3 py-1.5 text-left font-mono text-[11px] transition-colors ${
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
                      ? 'border-neon-green bg-neon-green text-black'
                      : 'border-gray-700 text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  <BookOpen className="h-4 w-4" /> Sagas
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex h-72 flex-col items-center justify-center gap-4">
                <RefreshCw className="h-10 w-10 animate-spin text-neon-pink" />
                <p className="font-mono text-xs text-gray-400">{status}</p>
              </div>
            ) : games.length === 0 ? (
              <div className="flex h-72 flex-col items-center justify-center gap-4 text-center">
                <FolderOpen className="h-14 w-14 text-gray-700" />
                <div>
                  <p className="font-mono text-sm text-gray-300">No se encontraron juegos</p>
                  <p className="mt-2 max-w-md font-mono text-xs text-gray-500">
                    Pulsa ESCANEAR para buscar juegos de Steam/Epic/GOG y accesos directos del
                    escritorio.
                  </p>
                </div>
              </div>
            ) : filteredGames.length === 0 ? (
              <div className="flex h-72 flex-col items-center justify-center gap-3 text-center">
                <Search className="h-12 w-12 text-gray-700" />
                <p className="font-mono text-sm text-gray-400">Sin resultados para tu búsqueda</p>
              </div>
            ) : view === 'catalog' ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                {filteredGames.map((game) => (
                  <GameCard key={game.id} game={game} onLaunch={handleLaunch} />
                ))}
              </div>
            ) : view === 'list' ? (
              <List
                height={Math.max(420, window.innerHeight - 230)}
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
                      <button
                        type="button"
                        onClick={() => handleLaunch(game)}
                        className="atlas-card flex h-[120px] w-full items-center gap-4 p-3 text-left hover:border-neon-pink"
                      >
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
                          </div>
                        </div>
                        <span
                          className="flex items-center rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-wider"
                          style={{ color: accent, borderColor: accent }}
                        >
                          <Play className="mr-1 h-3 w-3" /> Jugar
                        </span>
                      </button>
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
                        <div key={game.id} className="group">
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
    </div>
  );
}

export default App;
