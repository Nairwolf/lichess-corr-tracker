import './style.css';
import { LichessError, fetchGames, fetchUser, type Game, type User } from './lichess';
import { computeStats, dayKey, gamesByDay, parseDayKey } from './stats';
import {
  esc,
  filterGames,
  fmtDate,
  renderCalendar,
  renderMissed,
  renderOldest,
  renderSummary,
  renderTable,
  thumbnailUrl,
  type Filter,
  type Sort,
  type SortKey,
} from './render';

interface Cached {
  version: 1;
  user: User;
  games: Game[];
  fetchedAt: number;
}

interface State {
  user?: User;
  games: Game[];
  fetchedAt?: number;
  loading?: number;
  error?: string;
  filter: Filter;
  day?: string;
  sort: Sort;
}

const state: State = { games: [], filter: 'all', sort: { key: 'createdAt', dir: -1 } };
let controller: AbortController | undefined;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const usernameInput = $<HTMLInputElement>('username');
const sinceInput = $<HTMLInputElement>('since');
const preview = $<HTMLImageElement>('preview');

const cacheKey = (id: string) => `lch:games:${id}`;
const sinceKey = (id: string) => `lch:since:${id}`;

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
  if (cached) Object.assign(state, { user: cached.user, games: cached.games, fetchedAt: cached.fetchedAt });
  else Object.assign(state, { user: undefined, games: [], fetchedAt: undefined });
  usernameInput.value = cached?.user.username ?? username;
  history.replaceState(null, '', `?u=${encodeURIComponent(id)}`);
  render();

  try {
    const user = await fetchUser(username, signal);
    const since = cached ? incrementalSince(cached.games) : undefined;
    const fresh = await fetchGames(user, {
      since,
      signal,
      onGame: (n) => {
        state.loading = n;
        renderStatus();
      },
    });
    const kept = since ? cached!.games.filter((g) => g.createdAt < since) : [];
    const freshIds = new Set(fresh.map((g) => g.id));
    const games = [...fresh, ...kept.filter((g) => !freshIds.has(g.id))].sort((a, b) => b.createdAt - a.createdAt);
    const fetchedAt = Date.now();
    Object.assign(state, { user, games, fetchedAt, loading: undefined });
    usernameInput.value = user.username;
    writeCache({ version: 1, user, games, fetchedAt });
  } catch (e) {
    if (signal.aborted) return;
    state.loading = undefined;
    state.error = e instanceof LichessError ? e.message : `Impossible de joindre lichess : ${(e as Error).message}`;
  }
  render();
}

function sinceDate(): Date | undefined {
  const { user, games } = state;
  if (!user || !games.length) return undefined;
  const first = parseDayKey(dayKey(games.at(-1)!.createdAt));
  const stored = localStorage.getItem(sinceKey(user.id));
  return stored && parseDayKey(stored) > first ? parseDayKey(stored) : first;
}

function renderStatus() {
  const el = $('status');
  if (state.error) {
    el.innerHTML = `<div class="error">${esc(state.error)}</div>`;
  } else if (state.loading !== undefined) {
    const n = state.loading;
    el.innerHTML = `<div class="loading"><span class="spinner"></span>Chargement depuis lichess… ${n ? `${n} partie${n > 1 ? 's' : ''}` : ''}</div>`;
  } else if (state.fetchedAt) {
    const when = new Date(state.fetchedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    el.innerHTML = `<div class="info">Données du ${when}
      <button data-action="refresh">Rafraîchir</button>
      <button data-action="full" class="secondary" title="Ignore le cache et retélécharge toutes les parties">Tout recharger</button></div>`;
  } else {
    el.innerHTML = '';
  }
}

function render() {
  renderStatus();
  const { user, games } = state;
  const content = $('content');
  const since = sinceDate();
  content.hidden = !user || !since;
  if (!user || !since) {
    if (user && state.loading === undefined && !state.error) {
      $('status').insertAdjacentHTML('beforeend', `<p class="muted">${esc(user.username)} n'a aucune partie par correspondance.</p>`);
    }
    return;
  }

  const now = Date.now();
  const today = parseDayKey(dayKey(now));
  const byDay = gamesByDay(games);
  const stats = computeStats(games, byDay, since, today);

  const elo = user.corrRating ? ` · ${user.corrRating} elo` : '';
  $('user-title').innerHTML = `<a href="https://lichess.org/@/${esc(user.id)}" target="_blank" rel="noopener">${esc(user.username)}</a>
    <span class="muted">${elo} · ${stats.total} partie${stats.total > 1 ? 's' : ''}</span>`;
  $('summary').innerHTML = renderSummary(stats);
  $('oldest').innerHTML = renderOldest(stats.oldestOngoing, now);
  sinceInput.value = dayKey(since);
  sinceInput.min = dayKey(games.at(-1)!.createdAt);
  sinceInput.max = dayKey(today);
  $('calendar').innerHTML = renderCalendar(byDay, since, today, state.day);
  $('missed').innerHTML = renderMissed(stats.missedRanges);
  renderGames();
}

function renderGames() {
  const counts: Record<Filter, number> = {
    all: state.games.length,
    ongoing: filterGames(state.games, 'ongoing').length,
    myturn: filterGames(state.games, 'myturn').length,
    finished: filterGames(state.games, 'finished').length,
  };
  const labels: Record<Filter, string> = { all: 'Toutes', ongoing: 'En cours', myturn: 'À toi de jouer', finished: 'Terminées' };
  $('filters').innerHTML = (Object.keys(labels) as Filter[])
    .map((f) => `<button data-filter="${f}" class="${state.filter === f ? 'active' : ''}">${labels[f]} <span class="count">${counts[f]}</span></button>`)
    .join('');
  $('day-filter').innerHTML = state.day
    ? `<span class="chip">Parties démarrées le ${fmtDate(parseDayKey(state.day))} <button data-action="clear-day" title="Retirer le filtre">×</button></span>`
    : '';
  $('table').innerHTML = renderTable(filterGames(state.games, state.filter, state.day), state.sort, Date.now());
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

  const day = target.closest<HTMLElement>('#calendar [data-day]')?.dataset.day;
  if (day) selectDay(day);
});

sinceInput.addEventListener('change', () => {
  if (!state.user) return;
  if (sinceInput.value) localStorage.setItem(sinceKey(state.user.id), sinceInput.value);
  else localStorage.removeItem(sinceKey(state.user.id));
  render();
});

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

const initial = new URLSearchParams(location.search).get('u') ?? localStorage.getItem('lch:last');
if (initial) load(initial);
else usernameInput.focus();
