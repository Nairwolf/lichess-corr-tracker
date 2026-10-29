# lichess-corr-tracker — correspondence games

A small local site to visualize a lichess player's correspondence games:

- did I start a game every day? (calendar, missed days, current / longest streak)
- which is my oldest ongoing game?
- am I diligent? (games lost on time, average number of moves, W/D/L record)
- a sortable, filterable table of every game (ongoing, your turn, finished),
  with each game's pace in moves/day

Clicking a day in the calendar filters the table to the games started that day,
and clicking a row opens the game on lichess.

## Running

```sh
npm install
npm run dev
```

Then open http://localhost:5173/?u=username

## Notes

- Everything happens in the browser, which calls the public lichess API directly (no token).
- lichess limits the first load to ~20 games/s. Games are then cached in
  `localStorage`, and "Refresh" only re-downloads what may have changed.
- A day counts as "played" as soon as a correspondence game was created that day
  (local time zone), whichever player sent the challenge.
- lichess hides the last moves of ongoing games in its exports; the app compensates
  so it knows correctly whose turn it is.
