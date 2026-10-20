# Ludo Table

Team Ludo for one laptop, in the browser: a polished board, a 3D dice with a rolling animation, and a computer opponent that plays its colours on its own.

**Play:** https://akshatinnovate-png.github.io/Ludo-Game-Player/

## Playing

- **New game:** click each colour to make it Human or Computer. Opposite colours are partners (Red + Yellow, Green + Blue).
- **Roll:** click the dice or press **Space**.
- **Move:** pawns that can move glow. Hover a pawn to preview where it lands, then click the pawn or its target square. If you threw more than one number (for example 6, 6, 4), pick which number to play first by clicking it or pressing 1, 2 or 3.
- Computer colours roll and move by themselves. The game saves itself, so a refresh carries on where you left off.

## Rules

- A 6 brings a pawn out and earns another throw. You throw all your dice first, then move.
- Three 6s in a row don't count. The next throw starts fresh.
- Start squares and star squares are safe.
- Capturing, or getting a pawn home, earns an extra throw.
- You need the exact number to finish.
- Partners share every throw: a throw for either colour can move either colour's pawns. Partners never capture each other.
- A team wins when all 8 of its pawns are home.

## The computer

`src/engine.js` is an expectiminimax search, the dice equivalent of what chess engines do. It tries every way to play the throws, then looks ahead up to three turns, averaging over every die face. It scores positions using progress, safety, the chance of being captured and capture threats. It runs instantly in the browser, with no server and no limits.

## Development

```sh
npm test     # rules and engine tests
npm start    # http://localhost:8000
```

Every push to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/pages.yml`).
