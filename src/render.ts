import type { Game } from './lichess';
import { DAY_MS, addDays, dayKey, eachDay, fullMoves, type DayCount, type DayRange, type Stats } from './stats';

export type Filter = 'all' | 'ongoing' | 'myturn' | 'finished';
export type SortKey = 'createdAt' | 'opponent' | 'color' | 'state' | 'plies' | 'pace' | 'daysPerTurn' | 'lastMoveAt' | 'duration';
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

const STATUS_LABELS: Record<string, string> = {
  mate: 'mat',
  resign: 'abandon',
  outoftime: 'temps écoulé',
  timeout: 'victoire réclamée',
  stalemate: 'pat',
  draw: 'nulle',
  insufficientMaterialClaim: 'matériel insuffisant',
  cheat: 'triche',
  variantEnd: 'fin de variante',
  aborted: 'annulée',
  noStart: 'jamais commencée',
};

const RESULT_LABELS = { win: 'Victoire', loss: 'Défaite', draw: 'Nulle', aborted: 'Annulée' } as const;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const longDateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

export const fmtDate = (d: Date | number) => dateFmt.format(d);
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const days = (ms: number) => Math.floor(ms / DAY_MS);

function ago(ts: number, now: number): string {
  const d = days(now - ts);
  if (d === 0) return "aujourd'hui";
  if (d === 1) return 'hier';
  return d < 30 ? `il y a ${d} j` : fmtDate(ts);
}

const duration = (g: Game, now: number) => (g.ongoing ? now : g.lastMoveAt) - g.createdAt;
const pace = (g: Game, now: number) => fullMoves(g) / Math.max(duration(g, now) / DAY_MS, 1);
const decimalFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const gameUrl = (g: Game) => `https://lichess.org/${g.id}${g.color === 'black' ? '/black' : ''}`;
export const thumbnailUrl = (id: string) => `https://lichess1.org/game/export/gif/thumbnail/${id}.gif`;

function opponentHtml(g: Game): string {
  const title = g.opponentTitle ? `<span class="title">${esc(g.opponentTitle)}</span> ` : '';
  const rating = g.opponentRating ? ` <span class="muted">(${g.opponentRating})</span>` : '';
  return `${title}${esc(g.opponent)}${rating}`;
}

function stateHtml(g: Game): string {
  if (g.ongoing) {
    if (g.myTurn === null) return '<span class="badge waiting" title="Trait inconnu">En cours</span>';
    return g.myTurn
      ? '<span class="badge myturn">À toi de jouer</span>'
      : '<span class="badge waiting">En attente</span>';
  }
  const detail = STATUS_LABELS[g.status] ?? g.status;
  const diff = g.ratingDiff ? ` <span class="muted">${g.ratingDiff > 0 ? '+' : ''}${g.ratingDiff}</span>` : '';
  return `<span class="badge ${g.result}">${RESULT_LABELS[g.result!]}</span> <span class="muted">${esc(detail)}</span>${diff}`;
}

export function renderSummary(s: Stats): string {
  const card = (label: string, value: string, sub = '', cls = '') =>
    `<div class="card ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const finished = s.wins + s.draws + s.losses;
  const score = finished ? Math.round(((s.wins + s.draws / 2) / finished) * 100) : 0;
  const percent = (n: number, total: number) => (total ? ` (${Math.round((n / total) * 100)}&nbsp;%)` : '');
  return [
    card('Série en cours', plural(s.currentStreak, 'jour'), `record : ${plural(s.longestStreak, 'jour')}`),
    card(
      'Jours manqués',
      String(s.missedCount),
      `sur ${plural(s.analysedDays, 'jour')}${percent(s.missedCount, s.analysedDays)}`,
      s.missedCount ? 'bad' : 'good',
    ),
    card(
      'Perdues au temps',
      String(s.timeoutLosses),
      `sur ${plural(s.losses, 'défaite')}${percent(s.timeoutLosses, s.losses)}`,
      s.timeoutLosses ? 'bad' : 'good',
    ),
    card('En cours', String(s.ongoing), `dont ${s.myTurn} à toi de jouer`),
    card('Bilan', `${s.wins} / ${s.draws} / ${s.losses}`, `V / N / D — score ${score} %`),
    card(
      'Coups en moyenne',
      s.avgMoves === undefined ? '—' : decimalFmt.format(s.avgMoves),
      `sur ${finished} terminée${finished > 1 ? 's' : ''}`,
    ),
  ].join('');
}

export function renderOldest(g: Game | undefined, now: number): string {
  if (!g) return '<p class="muted">Aucune partie en cours.</p>';
  return `
    <a class="oldest" href="${gameUrl(g)}" target="_blank" rel="noopener">
      <img src="${thumbnailUrl(g.id)}" alt="" width="180" height="180">
      <div>
        <div class="big">${plural(days(now - g.createdAt), 'jour')}</div>
        <div>contre ${opponentHtml(g)}, avec les ${g.color === 'white' ? 'blancs' : 'noirs'}</div>
        <div class="muted">commencée le ${fmtDate(g.createdAt)} · ${plural(fullMoves(g), 'coup')} · dernier coup ${ago(g.lastMoveAt, now)}</div>
        <div>${stateHtml(g)}</div>
      </div>
    </a>`;
}

function cellClass(count: number): string {
  if (count === 0) return 'missed';
  return `l${Math.min(count, 3)}`;
}

export function renderCalendar(byDay: Map<string, Game[]>, since: Date, today: Date, selectedDay?: string): string {
  const years: string[] = [];
  for (let year = today.getFullYear(); year >= since.getFullYear(); year--) {
    const start = new Date(Math.max(+new Date(year, 0, 1), +since));
    const end = new Date(Math.min(+new Date(year, 11, 31), +today));
    const jan1 = new Date(year, 0, 1);
    const gridStart = addDays(jan1, -((jan1.getDay() + 6) % 7));
    const column = (d: Date) => Math.floor(Math.round((+d - +gridStart) / DAY_MS) / 7);

    let started = 0;
    let missed = 0;
    const cells: string[] = [];
    for (const d of eachDay(gridStart, end)) {
      if (d < start) {
        cells.push('<i class="out"></i>');
        continue;
      }
      const key = dayKey(d);
      const count = byDay.get(key)?.length ?? 0;
      const isToday = key === dayKey(today);
      started += count;
      if (count === 0 && !isToday) missed++;
      const title = `${longDateFmt.format(d)} — ${count ? plural(count, 'partie') : 'aucune partie'}`;
      const sel = key === selectedDay ? ' selected' : '';
      cells.push(`<i class="${cellClass(count)}${sel}" data-day="${key}" title="${title}"></i>`);
    }

    const months: string[] = [];
    for (let m = start.getMonth(); m <= end.getMonth(); m++) {
      const first = new Date(year, m, 1);
      const anchor = first < start ? start : first;
      months.push(`<span style="--col:${column(anchor)}">${monthFmt.format(first)}</span>`);
    }

    years.push(`
      <div class="year">
        <h3>${year} <span class="muted">— ${plural(started, 'partie')}, ${plural(missed, 'jour')} manqué${missed > 1 ? 's' : ''}</span></h3>
        <div class="months">${months.join('')}</div>
        <div class="grid">${cells.join('')}</div>
      </div>`);
  }
  return years.join('');
}

const CHART = { height: 220, top: 12, right: 44, bottom: 26, left: 36 };
const MIN_TICK_GAP = 44;

function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!);
}

export function chartScale(points: DayCount[], width: number) {
  const n = points.length;
  const plotW = Math.max(width - CHART.left - CHART.right, 1);
  const plotH = CHART.height - CHART.top - CHART.bottom;
  const step = niceStep(Math.max(1, ...points.map((p) => p.count)));
  const yMax = Math.ceil(Math.max(1, ...points.map((p) => p.count)) / step) * step;
  const dx = n > 1 ? plotW / (n - 1) : 0;
  return {
    step,
    yMax,
    x: (i: number) => CHART.left + (n > 1 ? i * dx : plotW),
    y: (v: number) => CHART.top + plotH * (1 - v / yMax),
    indexAt: (px: number) => (n > 1 ? Math.min(n - 1, Math.max(0, Math.round((px - CHART.left) / dx))) : 0),
  };
}

export const fmtLongDate = (d: Date) => longDateFmt.format(d);

export function renderOngoingChart(points: DayCount[], width: number): string {
  if (!points.length || width <= 0) return '';
  const { step, yMax, x, y } = chartScale(points, width);
  const right = width - CHART.right;
  const base = y(0);

  const grid: string[] = [];
  for (let v = 0; v <= yMax; v += step) {
    grid.push(`<line class="grid-line" x1="${CHART.left}" x2="${right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tick" x="${CHART.left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  }

  const first = points[0].day;
  const last = points.at(-1)!.day;
  const pxPerMonth = (right - CHART.left) / Math.max(points.length / 30.44, 1);
  const every = [1, 2, 3, 6, 12].find((m) => m * pxPerMonth >= MIN_TICK_GAP) ?? 12;
  const index = (d: Date) => Math.round((+d - +first) / DAY_MS);
  const months: string[] = [];
  for (let d = new Date(first.getFullYear(), first.getMonth() + 1, 1); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    if (d.getMonth() % every) continue;
    const label = d.getMonth() === 0 ? String(d.getFullYear()) : monthFmt.format(d);
    const cx = x(index(d));
    months.push(`<line class="axis" x1="${cx}" x2="${cx}" y1="${base}" y2="${base + 4}"/>
      <text class="tick${d.getMonth() === 0 ? ' year-tick' : ''}" x="${cx}" y="${base + 18}" text-anchor="middle">${label}</text>`);
  }

  let line = `M${x(0)},${y(points[0].count)}`;
  for (let i = 1; i < points.length; i++) line += `H${x(i)}V${y(points[i].count)}`;
  const area = `${line}V${base}H${x(0)}Z`;
  const end = points.at(-1)!;
  const endX = x(points.length - 1);
  const endY = y(end.count);

  const max = points.reduce((best, p) => (p.count > best.count ? p : best));
  const avg = points.reduce((sum, p) => sum + p.count, 0) / points.length;

  return `
    <div class="chart-stats">
      Aujourd'hui <strong>${end.count}</strong>
      <span class="muted">·</span> maximum <strong>${max.count}</strong> <span class="muted">le ${fmtDate(max.day)}</span>
      <span class="muted">·</span> moyenne <strong>${decimalFmt.format(avg)}</strong>
    </div>
    <svg class="chart" width="${width}" height="${CHART.height}" role="img"
      aria-label="Nombre de parties en cours par jour, du ${fmtDate(first)} au ${fmtDate(last)}">
      ${grid.join('')}
      <line class="axis" x1="${CHART.left}" x2="${right}" y1="${base}" y2="${base}"/>
      ${months.join('')}
      <path class="area" d="${area}"/>
      <path class="line" d="${line}"/>
      <circle class="dot" cx="${endX}" cy="${endY}" r="4"/>
      <text class="end-label" x="${endX + 10}" y="${endY + 4}">${end.count}</text>
      <g class="hover" visibility="hidden">
        <line class="crosshair" y1="${CHART.top}" y2="${base}"/>
        <circle class="dot" r="4"/>
      </g>
    </svg>
    <div class="chart-tip" hidden><strong></strong><span></span></div>
    <p class="muted note">Nombre de parties en cours à la fin de chaque jour. Une partie terminée compte jusqu'à son dernier coup :
      lichess ne donne pas la date de fin, donc une partie perdue au temps sort un peu trop tôt de la courbe.
      Les parties commencées avant la période sont comptées tant qu'elles sont en cours.</p>`;
}

export function renderMissed(ranges: DayRange[]): string {
  if (!ranges.length) return '<p class="good-text">Aucun jour manqué sur la période. Bravo !</p>';
  const MAX = 60;
  const chips = ranges.slice(0, MAX).map(({ from, to }) => {
    const n = Math.round((+to - +from) / DAY_MS) + 1;
    const label = n === 1 ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(to)} <span class="muted">(${n} j)</span>`;
    return `<li>${label}</li>`;
  });
  if (ranges.length > MAX) chips.push(`<li class="more">… et ${ranges.length - MAX} autres périodes</li>`);
  return `<ul class="missed-list">${chips.join('')}</ul>`;
}

function sortValue(g: Game, key: SortKey, now: number): number | string {
  switch (key) {
    case 'createdAt':
      return g.createdAt;
    case 'opponent':
      return g.opponent.toLowerCase();
    case 'color':
      return g.color;
    case 'state':
      return g.ongoing ? (g.myTurn ? 0 : 1) : { win: 2, draw: 3, loss: 4, aborted: 5 }[g.result!];
    case 'pace':
      return pace(g, now);
    case 'plies':
      return g.plies;
    case 'daysPerTurn':
      return g.daysPerTurn ?? Infinity;
    case 'lastMoveAt':
      return g.lastMoveAt;
    case 'duration':
      return duration(g, now);
  }
}

const COLUMNS: [SortKey, string][] = [
  ['createdAt', 'Début'],
  ['opponent', 'Adversaire'],
  ['color', 'Couleur'],
  ['state', 'État'],
  ['plies', 'Coups'],
  ['pace', 'Coups/jour'],
  ['daysPerTurn', 'Cadence'],
  ['lastMoveAt', 'Dernier coup'],
  ['duration', 'Durée'],
];

export function filterGames(games: Game[], filter: Filter, day?: string): Game[] {
  return games.filter((g) => {
    if (day && dayKey(g.createdAt) !== day) return false;
    if (filter === 'ongoing') return g.ongoing;
    if (filter === 'myturn') return g.myTurn === true;
    if (filter === 'finished') return !g.ongoing;
    return true;
  });
}

export function renderTable(games: Game[], sort: Sort, now: number): string {
  if (!games.length) return '<p class="muted">Aucune partie.</p>';
  const sorted = [...games].sort((a, b) => {
    const va = sortValue(a, sort.key, now);
    const vb = sortValue(b, sort.key, now);
    return (va < vb ? -1 : va > vb ? 1 : b.createdAt - a.createdAt) * sort.dir;
  });

  const head = COLUMNS.map(([key, label]) => {
    const arrow = sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return `<th data-sort="${key}">${label}${arrow}</th>`;
  }).join('');

  const rows = sorted.map((g) => {
    const cadence = g.daysPerTurn ? `${g.daysPerTurn} j/coup` : '∞';
    const variant = g.variant !== 'standard' ? ` <span class="muted">${esc(g.variant)}</span>` : '';
    return `
      <tr data-id="${g.id}" data-url="${gameUrl(g)}" class="${g.ongoing ? 'ongoing' : ''}">
        <td>${fmtDate(g.createdAt)} <span class="muted">${timeFmt.format(g.createdAt)}</span></td>
        <td><a href="${gameUrl(g)}" target="_blank" rel="noopener">${opponentHtml(g)}</a>${variant}${g.rated ? '' : ' <span class="muted">amicale</span>'}</td>
        <td><span class="piece ${g.color}"></span></td>
        <td>${stateHtml(g)}</td>
        <td class="num">${fullMoves(g)}</td>
        <td class="num">${decimalFmt.format(pace(g, now))}</td>
        <td>${cadence}</td>
        <td>${ago(g.lastMoveAt, now)}</td>
        <td class="num">${days(duration(g, now))} j</td>
      </tr>`;
  });

  return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
