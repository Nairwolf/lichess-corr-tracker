import type { Game, RatingPoint } from './lichess';

export const DAY_MS = 86_400_000;

export const fullMoves = (g: Game) => Math.ceil(g.plies / 2);

export function dayKey(d: Date | number): string {
  const date = typeof d === 'number' ? new Date(d) : d;
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${day}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function* eachDay(from: Date, to: Date): Generator<Date> {
  for (let d = addDays(from, 0); d <= to; d = addDays(d, 1)) yield d;
}

export function gamesByDay(games: Game[]): Map<string, Game[]> {
  const map = new Map<string, Game[]>();
  for (const g of games) {
    const key = dayKey(g.createdAt);
    const list = map.get(key);
    if (list) list.push(g);
    else map.set(key, [g]);
  }
  return map;
}

export interface DayRange {
  from: Date;
  to: Date;
}

export interface Stats {
  total: number;
  ongoing: number;
  myTurn: number;
  wins: number;
  draws: number;
  losses: number;
  timeoutLosses: number;
  avgMoves?: number;
  oldestOngoing?: Game;
  missedRanges: DayRange[];
  missedCount: number;
  analysedDays: number;
  currentStreak: number;
  longestStreak: number;
}

export function computeStats(games: Game[], byDay: Map<string, Game[]>, since: Date, today: Date): Stats {
  const ongoing = games.filter((g) => g.ongoing);
  const played = games.filter((g) => !g.ongoing && g.result !== 'aborted');
  const oldestOngoing = ongoing.reduce<Game | undefined>((old, g) => (!old || g.createdAt < old.createdAt ? g : old), undefined);

  const missedRanges: DayRange[] = [];
  let missedCount = 0;
  let analysedDays = 0;
  let run = 0;
  let longestStreak = 0;
  const yesterday = addDays(today, -1);
  for (const d of eachDay(since, yesterday)) {
    analysedDays++;
    if (byDay.has(dayKey(d))) {
      run++;
      longestStreak = Math.max(longestStreak, run);
      continue;
    }
    run = 0;
    missedCount++;
    const last = missedRanges.at(-1);
    if (last && dayKey(addDays(last.to, 1)) === dayKey(d)) last.to = d;
    else missedRanges.push({ from: d, to: d });
  }

  // Today only counts once a game has been started, but doesn't break the streak before that.
  const currentStreak = run + (byDay.has(dayKey(today)) ? 1 : 0);
  longestStreak = Math.max(longestStreak, currentStreak);

  return {
    total: games.length,
    ongoing: ongoing.length,
    myTurn: ongoing.filter((g) => g.myTurn).length,
    wins: games.filter((g) => g.result === 'win').length,
    draws: games.filter((g) => g.result === 'draw').length,
    losses: games.filter((g) => g.result === 'loss').length,
    timeoutLosses: games.filter((g) => g.result === 'loss' && g.status === 'outoftime').length,
    avgMoves: played.length ? played.reduce((sum, g) => sum + fullMoves(g), 0) / played.length : undefined,
    oldestOngoing,
    missedRanges: missedRanges.reverse(),
    missedCount,
    analysedDays,
    currentStreak,
    longestStreak,
  };
}

export interface DayCount {
  day: Date;
  count: number;
  rating?: number;
}

// Snapshot at the end of each day (now for today). A finished game is considered over at its last move.
export function ongoingByDay(games: Game[], since: Date, today: Date, now: number): DayCount[] {
  const played = games.filter((g) => g.result !== 'aborted');
  const starts = played.map((g) => g.createdAt).sort((a, b) => a - b);
  const ends = played.filter((g) => !g.ongoing).map((g) => g.lastMoveAt).sort((a, b) => a - b);
  const points: DayCount[] = [];
  let started = 0;
  let ended = 0;
  for (const day of eachDay(since, today)) {
    const t = Math.min(+addDays(day, 1), now);
    while (started < starts.length && starts[started] < t) started++;
    while (ended < ends.length && ends[ended] < t) ended++;
    points.push({ day, count: started - ended });
  }
  return points;
}

// Fallback when lichess returns no rating history: the rating each game started with, then the current one.
export function ratingsFromGames(games: Game[], current: number | undefined, at: number): RatingPoint[] {
  const points = games
    .filter((g) => g.variant === 'standard' && g.myRating !== undefined)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((g) => ({ day: dayKey(g.createdAt), rating: g.myRating! }));
  if (current !== undefined) points.push({ day: dayKey(at), rating: current });
  return points;
}

// The rating holds between two changes; it is unknown before the first one.
export function withRatings(points: DayCount[], history: RatingPoint[]): DayCount[] {
  let i = 0;
  let rating: number | undefined;
  return points.map((p) => {
    const key = dayKey(p.day);
    while (i < history.length && history[i].day <= key) rating = history[i++].rating;
    return { ...p, rating };
  });
}

export const PRESETS = { '30d': '30 days', '3m': '3 months', '6m': '6 months', year: 'This year', '12m': '12 months', all: 'All' } as const;
export type Preset = keyof typeof PRESETS;

export const isPreset = (p: string): p is Preset => p in PRESETS;

export function presetStart(p: Preset, today: Date): Date | undefined {
  const [y, m, d] = [today.getFullYear(), today.getMonth(), today.getDate()];
  switch (p) {
    case '30d':
      return addDays(today, -29);
    case '3m':
      return new Date(y, m - 3, d + 1);
    case '6m':
      return new Date(y, m - 6, d + 1);
    case 'year':
      return new Date(y, 0, 1);
    case '12m':
      return new Date(y - 1, m, d + 1);
    case 'all':
      return undefined;
  }
}
