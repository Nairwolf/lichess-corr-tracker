import { dayKey } from './stats';

export type Color = 'white' | 'black';
export type Result = 'win' | 'loss' | 'draw' | 'aborted';

interface RawPlayer {
  user?: { name: string; id: string; title?: string };
  rating?: number;
  ratingDiff?: number;
  aiLevel?: number;
}

interface RawGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: Record<Color, RawPlayer>;
  winner?: Color;
  moves?: string;
  daysPerTurn?: number;
  initialFen?: string;
}

export interface Game {
  id: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  ongoing: boolean;
  color: Color;
  opponent: string;
  opponentTitle?: string;
  opponentRating?: number;
  myRating?: number;
  ratingDiff?: number;
  result: Result | null;
  plies: number;
  myTurn: boolean | null;
  daysPerTurn?: number;
  rated: boolean;
  variant: string;
}

export interface User {
  id: string;
  username: string;
  corrRating?: number;
  corrGames?: number;
}

// Rating at the end of a day where it changed (`day` is a YYYY-MM-DD key).
export interface RatingPoint {
  day: string;
  rating: number;
}

export class LichessError extends Error {}

const API = 'https://lichess.org/api';
const ONGOING_STATUSES = new Set(['created', 'started']);
const ABORTED_STATUSES = new Set(['aborted', 'noStart']);
// Exports of ongoing games hide the last 3 plies, but always keep the first 5 (min(real, 5)).
const HIDDEN_PLIES = 3;
const KEPT_PLIES = 5;

async function get(url: string, accept: string, notFound: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { headers: { Accept: accept }, signal });
  if (res.status === 404) throw new LichessError(notFound);
  if (res.status === 429) throw new LichessError('Trop de requêtes : lichess demande de patienter une minute.');
  if (!res.ok) throw new LichessError(`Erreur lichess (HTTP ${res.status}).`);
  return res;
}

export async function fetchUser(username: string, signal?: AbortSignal): Promise<User> {
  const res = await get(`${API}/user/${encodeURIComponent(username)}`, 'application/json', 'Utilisateur introuvable sur lichess.', signal);
  const data = await res.json();
  if (data.disabled) throw new LichessError('Ce compte lichess est fermé.');
  const corr = data.perfs?.correspondence;
  return { id: data.id, username: data.username, corrRating: corr?.rating, corrGames: corr?.games };
}

// Points are [year, month (0-based), day, rating], one per day where the rating changed.
export async function fetchRatingHistory(user: User, signal?: AbortSignal): Promise<RatingPoint[]> {
  const res = await get(`${API}/user/${encodeURIComponent(user.id)}/rating-history`, 'application/json', 'Utilisateur introuvable sur lichess.', signal);
  const perfs: { name: string; points: [number, number, number, number][] }[] = await res.json();
  const points = perfs.find((p) => p.name === 'correspondence')?.points ?? [];
  return points.map(([y, m, d, rating]) => ({ day: dayKey(new Date(y, m, d)), rating }));
}

async function* streamNdjson<T = RawGame>(url: string, signal?: AbortSignal): AsyncGenerator<T> {
  const res = await get(url, 'application/x-ndjson', "lichess a refusé l'export des parties (404).", signal);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

function normalize(raw: RawGame, userId: string): Game {
  const color: Color = raw.players.white.user?.id === userId ? 'white' : 'black';
  const me = raw.players[color];
  const opp = raw.players[color === 'white' ? 'black' : 'white'];
  const ongoing = ONGOING_STATUSES.has(raw.status);
  const shownPlies = raw.moves ? raw.moves.split(' ').length : 0;
  const plies = ongoing && shownPlies > KEPT_PLIES ? shownPlies + HIDDEN_PLIES : shownPlies;
  const turnKnown = !ongoing || shownPlies !== KEPT_PLIES;

  let result: Result | null = null;
  if (ABORTED_STATUSES.has(raw.status)) result = 'aborted';
  else if (!ongoing) result = raw.winner ? (raw.winner === color ? 'win' : 'loss') : 'draw';

  const firstToMove: Color = raw.initialFen?.split(' ')[1] === 'b' ? 'black' : 'white';
  const toMove = plies % 2 === 0 ? firstToMove : firstToMove === 'white' ? 'black' : 'white';

  return {
    id: raw.id,
    createdAt: raw.createdAt,
    lastMoveAt: raw.lastMoveAt,
    status: raw.status,
    ongoing,
    color,
    opponent: opp.user?.name ?? (opp.aiLevel ? `Stockfish niv. ${opp.aiLevel}` : 'Anonyme'),
    opponentTitle: opp.user?.title,
    opponentRating: opp.rating,
    myRating: me.rating,
    ratingDiff: me.ratingDiff,
    result,
    plies,
    myTurn: ongoing && turnKnown ? toMove === color : null,
    daysPerTurn: raw.daysPerTurn,
    rated: raw.rated,
    variant: raw.variant,
  };
}

// The live game stream replays every position (one FEN per line) then stays open: stop once it goes quiet.
async function fetchLivePosition(id: string, signal?: AbortSignal): Promise<{ toMove: Color; plies: number }> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort);
  let timer = setTimeout(abort, 8000);
  let fen: string | undefined;
  let plies = -1;
  try {
    for await (const line of streamNdjson<{ fen?: string }>(`${API}/stream/game/${id}`, ctrl.signal)) {
      if (line.fen) {
        fen = line.fen;
        plies++;
      }
      clearTimeout(timer);
      timer = setTimeout(abort, 1000);
    }
  } catch (e) {
    if (!ctrl.signal.aborted || signal?.aborted) throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  if (!fen) throw new LichessError(`Position introuvable pour la partie ${id}.`);
  return { toMove: fen.split(' ')[1] === 'b' ? 'black' : 'white', plies };
}

// lichess omits ongoing games when perfType is set, so they are fetched separately and filtered here.
export async function fetchGames(
  user: User,
  opts: { since?: number; onGame?: (count: number) => void; signal?: AbortSignal } = {},
): Promise<Game[]> {
  const base = `${API}/games/user/${encodeURIComponent(user.id)}`;
  const since = opts.since ? `&since=${opts.since}` : '';
  const urls = [
    `${base}?ongoing=true&finished=false&moves=true`,
    `${base}?perfType=correspondence&moves=true${since}`,
  ];

  const games = new Map<string, Game>();
  await Promise.all(
    urls.map(async (url) => {
      for await (const raw of streamNdjson(url, opts.signal)) {
        if (raw.speed !== 'correspondence') continue;
        games.set(raw.id, normalize(raw, user.id));
        opts.onGame?.(games.size);
      }
    }),
  );

  for (const g of games.values()) {
    if (!g.ongoing || g.myTurn !== null) continue;
    try {
      const live = await fetchLivePosition(g.id, opts.signal);
      g.plies = live.plies;
      g.myTurn = live.toMove === g.color;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
    }
  }
  return [...games.values()].sort((a, b) => b.createdAt - a.createdAt);
}
