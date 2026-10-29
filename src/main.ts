import './style.css';
import { LichessError, fetchGames, fetchRatingHistory, fetchUser, type Game, type RatingPoint, type User } from './lichess';
import {
  PRESETS,
  computeStats,
  dayKey,
  gamesByDay,
  isPreset,
  ongoingByDay,
  parseDayKey,
  presetStart,
  ratingsFromGames,
  withRatings,
  type DayCount,
  type Preset,
} from './stats';
import {
  chartScale,
  esc,
  filterGames,
  fmtDate,
  fmtLongDate,
  renderCalendar,
  renderMissed,
  renderOngoingChart,
  renderSeriesToggles,
  renderOldest,
  renderSummary,
  renderTable,
  thumbnailUrl,
  type Filter,
  type Series,
  type Sort,
  type SortKey,
} from './render';

interface Cached {
  version: 1;
  user: User;
  games: Game[];
  ratings?: RatingPoint[];
  fetchedAt: number;
}

interface State {
  user?: User;
  games: Game[];
  ratings?: RatingPoint[];
  fetchedAt?: number;
  loading?: number;
  error?: string;
  filter: Filter;
  day?: string;
  sort: Sort;
}

const state: State = { games: [], filter: 'all', sort: { key: 'createdAt', dir: -1 } };
let controller: AbortController | undefined;
let periodGames: Game[] = [];
let chartPoints: DayCount[] = [];
let chartWidth = 0;
let chartSeries: Series = { ongoing: true, rating: true };
let ratingsFromLichess = true;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const usernameInput = $<HTMLInputElement>('username');
const sinceInput = $<HTMLInputElement>('since');
const preview = $<HTMLImageElement>('preview');

const cacheKey = (id: string) => `lch:games:${id}`;
const sinceKey = (id: string) => `lch:since:${id}`;
const SERIES_KEY = 'lch:chart-series';

function readSeries(): Series {
  try {
    return { ongoing: true, rating: true, ...JSON.parse(localStorage.getItem(SERIES_KEY) ?? '{}') };
  } catch {
    return { ongoing: true, rating: true };
  }
}
let series = readSeries();

function readCache(id: string): Cached | undefined {
  try {
    const data = JSON.parse(localStorage.getItem(cacheKey(id)) ?? 'null');
    return data?.version === 1 ? data : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(c: Cached) {
  try {
    localStorage.setItem(cacheKey(c.user.id), JSON.stringify(c));
    localStorage.setItem('lch:last', c.user.id);
  } catch {
    // Quota exceeded: the app still works, just without cache.
  }
}

// Only games that could still change (ongoing ones, or newer than anything known) are re-downloaded.
function incrementalSince(games: Game[]): number | undefined {
  if (!games.length) return undefined;
  const ongoing = games.filter((g) => g.ongoing);
  return Math.min(...(ongoing.length ? ongoing : games.slice(0, 1)).map((g) => g.createdAt));
}

async function load(username: string, full = false) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const id = username.toLowerCase();
  const cached = full ? undefined : readCache(id);

  if (state.user?.id !== id) Object.assign(state, { filter: 'all', day: undefined });
  Object.assign(state, { error: undefined, loading: 0 });
  if (cached) Object.assign(state, { user: cached.user, games: cached.games, ratings: cached.ratings, fetchedAt: cached.fetchedAt });
  else Object.assign(state, { user: undefined, games: [], ratings: undefined, fetchedAt: undefined });
  usernameInput.value = cached?.user.username ?? username;
  history.replaceState(null, '', `?u=${encodeURIComponent(id)}`);
  render();

  try {
    const user = await fetchUser(username, signal);
    const since = cached ? incrementalSince(cached.games) : undefined;
    const [fresh, ratings] = await Promise.all([
      fetchGames(user, {
        since,
        signal,
        onGame: (n) => {
          state.loading = n;
          renderStatus();
        },
      }),
      // The chart can do without the rating: keep the cached one rather than failing the whole load.
      fetchRatingHistory(user, signal).catch((e) => {
        if (signal.aborted) throw e;
        return cached?.ratings;
      }),
    ]);
    const kept = since ? cached!.games.filter((g) => g.createdAt < since) : [];
    const freshIds = new Set(fresh.map((g) => g.id));
    const games = [...fresh, ...kept.filter((g) => !freshIds.has(g.id))].sort((a, b) => b.createdAt - a.createdAt);
    const fetchedAt = Date.now();
    Object.assign(state, { user, games, ratings, fetchedAt, loading: undefined });
    usernameInput.value = user.username;
    writeCache({ version: 1, user, games, ratings, fetchedAt });
  } catch (e) {
    if (signal.aborted) return;
    state.loading = undefined;
    state.error = e instanceof LichessError ? e.message : `Couldn't reach lichess: ${(e as Error).message}`;
  }
  render();
}

// Stored as a preset key, or as a YYYY-MM-DD start date for a custom period.
const storedPeriod = (id: string) => localStorage.getItem(sinceKey(id)) ?? 'all';

function sinceDate(today: Date): Date | undefined {
  const { user, games } = state;
  if (!user || !games.length) return undefined;
  const first = parseDayKey(dayKey(games.at(-1)!.createdAt));
  const period = storedPeriod(user.id);
  const start = isPreset(period) ? presetStart(period, today) : parseDayKey(period);
  return start && start > first ? start : first;
}

function setPeriod(period: string) {
  if (!state.user) return;
  if (period === 'all') localStorage.removeItem(sinceKey(state.user.id));
  else localStorage.setItem(sinceKey(state.user.id), period);
  state.day = undefined;
  render();
}

function renderStatus() {
  const el = $('status');
  if (state.error) {
    el.innerHTML = `<div class="error">${esc(state.error)}</div>`;
  } else if (state.loading !== undefined) {
    const n = state.loading;
    el.innerHTML = `<div class="loading"><span class="spinner"></span>Loading from lichess… ${n ? `${n} game${n > 1 ? 's' : ''}` : ''}</div>`;
  } else if (state.fetchedAt) {
    const when = new Date(state.fetchedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    el.innerHTML = `<div class="info">Data as of ${when}
      <button data-action="refresh">Refresh</button>
      <button data-action="full" class="secondary" title="Ignores the cache and downloads every game again">Reload all</button></div>`;
  } else {
    el.innerHTML = '';
  }
}

function render() {
  renderStatus();
  const { user, games } = state;
  const content = $('content');
  const now = Date.now();
  const today = parseDayKey(dayKey(now));
  const since = sinceDate(today);
  content.hidden = !user || !since;
  if (!user || !since) {
    if (user && state.loading === undefined && !state.error) {
      $('status').insertAdjacentHTML('beforeend', `<p class="muted">${esc(user.username)} has no correspondence games.</p>`);
    }
    return;
  }

  periodGames = games.filter((g) => g.createdAt >= +since);
  const byDay = gamesByDay(periodGames);
  const stats = computeStats(periodGames, byDay, since, today);
  const period = storedPeriod(user.id);
  $('presets').innerHTML = (Object.keys(PRESETS) as Preset[])
    .map((p) => `<button data-period="${p}" class="${period === p ? 'active' : ''}">${PRESETS[p]}</button>`)
    .join('');
  $('custom-period').classList.toggle('active', !isPreset(period));

  const elo = user.corrRating ? ` · ${user.corrRating} elo` : '';
  $('user-title').innerHTML = `<a href="https://lichess.org/@/${esc(user.id)}" target="_blank" rel="noopener">${esc(user.username)}</a>
    <span class="muted">${elo} · ${stats.total} game${stats.total === 1 ? '' : 's'}</span>`;
  $('summary').innerHTML = renderSummary(stats);
  $('oldest').innerHTML = renderOldest(stats.oldestOngoing, now);
  sinceInput.value = dayKey(since);
  sinceInput.min = dayKey(games.at(-1)!.createdAt);
  sinceInput.max = dayKey(today);
  $('calendar').innerHTML = renderCalendar(byDay, since, today, state.day);
  $('missed').innerHTML = renderMissed(stats.missedRanges);
  ratingsFromLichess = !!state.ratings?.length;
  const ratings = ratingsFromLichess ? state.ratings! : ratingsFromGames(games, user.corrRating, state.fetchedAt ?? now);
  chartPoints = withRatings(ongoingByDay(games, since, today, now), ratings);
  renderChart();
  renderGames();
}

function renderChart() {
  const el = $('ongoing-chart');
  const hasRatings = chartPoints.some((p) => p.rating !== undefined);
  chartSeries = { ongoing: series.ongoing || !series.rating || !hasRatings, rating: series.rating && hasRatings };
  $('chart-series').innerHTML = hasRatings ? renderSeriesToggles(chartSeries) : '';
  chartWidth = el.clientWidth;
  el.innerHTML = renderOngoingChart(chartPoints, chartWidth, chartSeries, ratingsFromLichess);
}

function renderGames() {
  const counts: Record<Filter, number> = {
    all: periodGames.length,
    ongoing: filterGames(periodGames, 'ongoing').length,
    myturn: filterGames(periodGames, 'myturn').length,
    finished: filterGames(periodGames, 'finished').length,
  };
  const labels: Record<Filter, string> = { all: 'All', ongoing: 'Ongoing', myturn: 'Your turn', finished: 'Finished' };
  $('filters').innerHTML = (Object.keys(labels) as Filter[])
    .map((f) => `<button data-filter="${f}" class="${state.filter === f ? 'active' : ''}">${labels[f]} <span class="count">${counts[f]}</span></button>`)
    .join('');
  $('day-filter').innerHTML = state.day
    ? `<span class="chip">Games started on ${fmtDate(parseDayKey(state.day))} <button data-action="clear-day" title="Remove filter">×</button></span>`
    : '';
  $('table').innerHTML = renderTable(filterGames(periodGames, state.filter, state.day), state.sort, Date.now());
}

function selectDay(day: string) {
  state.day = state.day === day ? undefined : day;
  render();
  if (state.day) $('games').scrollIntoView({ behavior: 'smooth' });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (name) load(name);
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'refresh' && state.user) load(state.user.id);
  if (action === 'full' && state.user) load(state.user.id, true);
  if (action === 'clear-day') selectDay(state.day!);

  const filter = target.closest<HTMLElement>('[data-filter]')?.dataset.filter as Filter | undefined;
  if (filter) {
    state.filter = filter;
    renderGames();
  }

  const sortKey = target.closest<HTMLElement>('[data-sort]')?.dataset.sort as SortKey | undefined;
  if (sortKey) {
    const ascByDefault = sortKey === 'opponent' || sortKey === 'color' || sortKey === 'state';
    state.sort = state.sort.key === sortKey ? { key: sortKey, dir: state.sort.dir === 1 ? -1 : 1 } : { key: sortKey, dir: ascByDefault ? 1 : -1 };
    renderGames();
  }

  const toggle = target.closest<HTMLElement>('[data-series]');
  if (toggle && toggle.getAttribute('aria-disabled') !== 'true') {
    const key = toggle.dataset.series as keyof Series;
    series = { ...chartSeries, [key]: !chartSeries[key] };
    localStorage.setItem(SERIES_KEY, JSON.stringify(series));
    renderChart();
  }

  const period = target.closest<HTMLElement>('[data-period]')?.dataset.period;
  if (period) setPeriod(period);

  const day = target.closest<HTMLElement>('#calendar [data-day]')?.dataset.day;
  if (day) selectDay(day);
});

sinceInput.addEventListener('change', () => setPeriod(sinceInput.value || 'all'));

function openRow(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest('a') || (e.type === 'auxclick' && e.button !== 1)) return;
  const url = target.closest<HTMLElement>('tr[data-url]')?.dataset.url;
  if (url) window.open(url, '_blank', 'noopener');
}
$('table').addEventListener('click', openRow);
$('table').addEventListener('auxclick', openRow);

$('table').addEventListener('mouseover', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]');
  if (!row) {
    preview.hidden = true;
    return;
  }
  const src = thumbnailUrl(row.dataset.id!);
  if (preview.src !== src) preview.src = src;
  const rect = row.getBoundingClientRect();
  preview.style.top = `${Math.min(rect.top, innerHeight - 200)}px`;
  preview.hidden = false;
});
$('table').addEventListener('mouseleave', () => (preview.hidden = true));

new ResizeObserver(() => {
  if (chartPoints.length && $('ongoing-chart').clientWidth !== chartWidth) renderChart();
}).observe($('ongoing-chart'));

$('ongoing-chart').addEventListener('pointermove', (e) => {
  const el = $('ongoing-chart');
  const svg = el.querySelector('svg');
  const hover = svg?.querySelector<SVGGElement>('.hover');
  const tip = el.querySelector<HTMLElement>('.chart-tip');
  if (!svg || !hover || !tip) return;
  const scale = chartScale(chartPoints, chartWidth, chartSeries);
  const box = svg.getBoundingClientRect();
  const origin = el.getBoundingClientRect();
  const i = scale.indexAt(e.clientX - box.left);
  const p = chartPoints[i];
  const x = String(scale.x(i));
  const line = hover.querySelector('line')!;
  line.setAttribute('x1', x);
  line.setAttribute('x2', x);
  const ys: number[] = [];
  const place = (cls: 'ongoing' | 'rating', value: number | undefined, y: (v: number) => number, text: (v: number) => string) => {
    const dot = hover.querySelector(`circle.${cls}`);
    const row = tip.querySelector<HTMLElement>(`strong.${cls}`)!;
    row.hidden = !dot || value === undefined;
    if (!dot) return;
    dot.setAttribute('display', value === undefined ? 'none' : 'inline');
    if (value === undefined) return;
    ys.push(y(value));
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', String(y(value)));
    row.textContent = text(value);
  };
  place('ongoing', p.count, scale.y, (n) => `${n} ongoing game${n === 1 ? '' : 's'}`);
  place('rating', p.rating, scale.yRating, (r) => `${r} elo`);
  hover.setAttribute('visibility', 'visible');
  tip.querySelector('span')!.textContent = fmtLongDate(p.day);
  tip.hidden = false;
  const half = tip.offsetWidth / 2;
  tip.style.left = `${Math.min(Math.max(box.left - origin.left + scale.x(i), half), el.clientWidth - half)}px`;
  tip.style.top = `${box.top - origin.top + Math.min(...ys, scale.tickY(0))}px`;
});
$('ongoing-chart').addEventListener('pointerleave', () => {
  $('ongoing-chart').querySelector<SVGGElement>('.hover')?.setAttribute('visibility', 'hidden');
  const tip = $('ongoing-chart').querySelector<HTMLElement>('.chart-tip');
  if (tip) tip.hidden = true;
});

const initial = new URLSearchParams(location.search).get('u') ?? localStorage.getItem('lch:last');
if (initial) load(initial);
else usernameInput.focus();
