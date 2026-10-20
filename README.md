# Ludo Player

A phone web app that watches a real Ludo board through the camera and tells you the best move for the computer's two colours (team play: 2 colours for the computer, 2 for the humans). You move the tokens for it.

Everything runs in the browser: no server, no API key, no downloads, no rate limits.

## How a game goes

1. **Start a game.** Pick which colour sits in each corner, the computer's two colours, and who throws first.
2. **Learn the board (once).** With every token in its yard, take a photo in the app. Tap the outer corner of each yard, then one token of each colour.
3. **Every turn:** enter the throws (1–6 buttons), then:
   - **Human turn:** move your tokens, tap 📷 and take a photo. The app checks the photo against every legal move for those throws, starting from the last saved board, and shows its best guess with arrows. Confirm it or pick another.
   - **Computer turn:** the best move appears immediately on the virtual board. Tap 📷 to see it drawn on a photo of the real board. Move the tokens, then tap **Done**.
4. **Fixing mistakes:** ⋯ menu → *Edit board by hand* (tap a token, then tap where it really is), *Undo*, or *Re-learn the board* if the lighting or camera position changed a lot.

The game is saved on the phone after every step. Close the tab and use *Continue saved game* to pick up again.

## Rules used

- A 6 brings a token out, and a 6 earns another throw. Enter all throws for the turn (6, 6, 4…) before moving.
- Three 6s in a row are void. The next throw starts the turn afresh.
- Start squares and star squares are safe.
- Capturing, or getting a token home, earns an extra throw.
- You need the exact number to finish.
- Teammates share throws: a throw by either colour can move either colour's tokens. Teammates never capture each other.

## The engine

`src/engine.js` is an expectiminimax search, the dice equivalent of what Stockfish does for chess. It tries every way to play the throws, then looks ahead up to three turns, averaging over every die face. It scores positions using progress, safety, the chance of being captured and capture threats. A turn takes a fraction of a second on a phone.

## Photo reading

`src/vision.js` uses on-device colour detection. The four corner taps fix the board's perspective. Each track square is then compared with how it looked empty and with the tapped token colours. That reading is matched against the boards that could legally follow the last saved one, which is why reading works even when the photo is imperfect. For best results, shoot from roughly above, in even light, and keep the phone in a similar spot each time. If the grid drawn on the photo doesn't line up, tap *Grid is off: re-mark corners*.

## Hosting on GitHub Pages

Repo → Settings → Pages → *Deploy from a branch* → pick the branch and `/ (root)`. Open the URL on your phone. The camera needs HTTPS, which Pages provides.

## Development

```sh
npm test          # rules, engine and synthetic-photo tests (Node 20+)
npm start         # serves on http://localhost:8000
```
