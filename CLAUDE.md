# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A local-only static web app (UI text in French) that shows a lichess user's correspondence games. Its purpose is to answer two questions: "did I start a game every day?" and "which is my oldest ongoing game?". Stack: Vite + TypeScript with the native DOM. There is no framework, no backend and no runtime dependency.

## Commands

- `npm run dev`: dev server, then open `http://localhost:5173/?u=<username>`
- `npm run typecheck`: `tsc --noEmit`. This is the only automated check; there are no tests and no linter.
- `npm run build`: typecheck, then `vite build` into `dist/`

To check UI changes, drive `/usr/bin/chromium` with `puppeteer-core` installed in a temporary directory outside the repo (not as a project dependency), with a normal User-Agent (see below).

## Architecture

The browser calls the public lichess API directly, without a token. lichess allows CORS.

- `src/lichess.ts`: API access. It streams NDJSON and normalizes raw games into `Game`, which is seen from the user's perspective: color, opponent, result, `myTurn`, `plies`.
- `src/stats.ts`: pure functions. Days are keyed in **local time** (`dayKey`, `YYYY-MM-DD`). It computes missed days, streaks, the oldest ongoing game, timeout losses and the average number of moves. Today never counts as missed.
- `src/render.ts`: functions that return HTML strings: summary cards, GitHub-style calendar, games table with sorting and filtering. Escape any user data with `esc()`.
- `src/main.ts`: global `state`, a `render()` that re-renders everything, event delegation on `document`, and the `localStorage` cache.

Caching in `main.ts`: games are stored under `lch:games:<userId>`, with `version: 1` in the payload; the selected period is stored under `lch:since:<userId>`, as a preset key (`PRESETS` in `stats.ts`) or a custom `YYYY-MM-DD` start date. The period filters every section (on `createdAt`), except the ongoing-games chart, which still counts games started before the period. "Rafraîchir" is incremental: `incrementalSince` keeps cached games created before the oldest ongoing game, since finished games are immutable, and re-downloads everything after that date. "Tout recharger" ignores the cache. If the `Game` shape changes in an incompatible way, bump the cache version.

## lichess API quirks (verified empirically, don't "simplify" them away)

- **`perfType=correspondence` drops ongoing games**, even with `ongoing=true`. `fetchGames` therefore makes two requests: ongoing games across all speeds (`ongoing=true&finished=false`, filtered client-side on `speed === 'correspondence'`) and finished games with `perfType`. Results are merged by id.
- **Exports of ongoing games hide the last 3 plies, but always keep the first 5**: shown = `real <= 5 ? real : max(5, real - 3)`. So above 5 shown plies, add 3. Exactly 5 shown plies is ambiguous (the real count is 5 to 8). For those games, `fetchLivePosition` reads `/api/stream/game/{id}`, which replays every FEN and then stays open, and stops once the stream goes quiet. The side to move (`myTurn`) depends on this, so it is easy to get wrong.
- The single-game export (`/game/export/{id}`) now requires a login and is not used. Board thumbnails come from `https://lichess1.org/game/export/gif/thumbnail/{id}.gif` (white orientation only).
- Game statuses: a loss on time is `outoftime`. `timeout` means the opponent left and victory was claimed, so don't mix them up.
- Correspondence games have no per-move timestamps, so "Coups/jour" is a whole-game average.
- Anonymous exports are throttled to about 20 games/s, so a first load of a long history is slow.
- lichess returns 404 for curl's default User-Agent and for `HeadlessChrome`. When testing with curl or puppeteer, set a normal browser User-Agent.
