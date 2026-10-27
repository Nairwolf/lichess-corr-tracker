import type { Game } from './lichess';

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
