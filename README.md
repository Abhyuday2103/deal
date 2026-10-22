# Business Deal (card game)

The fast property card game, for 2 to 5 players, each on their own phone or laptop. Computer players are optional, for empty seats or practice. First to 3 full property sets of different colours wins.

Same setup as the other Game Night games:
- **GitHub Pages** serves the website from the `docs` folder (`gh-pages` branch).
- **A Firebase function** (`dl`) shuffles, deals and checks every move. Nobody's browser ever receives another player's hand or the deck.
- It shares the Teen Patti Firebase project (`teenpatti-44fde`) with its own function (`dl`), codebase (`deal`) and collection (`dltables`). Deploying it never touches the other games.

## Files

| Where | What |
|---|---|
| `docs/index.html`, `docs/style.css`, `docs/app.js` | The website: home, lobby, table, hand, paying and responding |
| `docs/engine.js` | The deck and all the rules. Also runs practice games in the browser |
| `docs/firebase-config.js` | Firebase web config (safe to be public) |
| `functions/` | The Firebase function. `functions/engine.js` is a copy of `docs/engine.js`; run `npm run sync` after changing rules |
| `firestore.rules` | Database rules for every game in the project |
| `tests/` | Rules and server tests (`npm test`) |
| `tools/` | Bot simulator, practice screenshots, multi-browser emulator test |

## Rules as built

- 106 cards: 20 money, 34 actions, 13 rent, 28 properties, 11 wild properties.
- Deal 5 each. On your turn draw 2 (5 if your hand is empty), play up to 3 cards, end with 7 or fewer.
- Property goes on your table. Money and action cards can go in your bank as money.
- Pay from your bank and table, never your hand. No change. Can't cover it? You pay everything you have on the table.
- Rent: two-colour cards charge everyone, Wild Rent charges one player. Double Rent doubles it and uses a play.
- Takeover steals a full set with its buildings. Sneaky Grab steals one property not in a full set. Swap trades one for one, not from full sets.
- Vasooli: one player pays ₹5M. Birthday: everyone pays ₹2M. Payday: draw 2.
- House +₹3M, Hotel +₹4M on a full set (not Railway or Utility).
- No Deal cancels an action against you, and can be No Dealt back.
- Wild properties can be moved between colours on your turn for free. A set made only of Any Colour wilds doesn't count.
- The host can change sets needed to win (2, 3 or 4) and plays per turn (3 or 4).

## Deploy the server (one time, from your laptop)

Practice mode works without this. Online tables need the function deployed once:

```
git clone https://github.com/Abhyuday2103/deal.git
cd deal
cd functions && npm install && cd ..
npx firebase-tools deploy --only functions:deal,firestore:rules --project teenpatti-44fde
```

## Update the website

`git subtree push --prefix docs origin gh-pages` (Claude does this for you).

## Online play (Oct 2026)
Online tables no longer need the Firebase function. The host's browser runs the same server code (`srv/`) and friends connect straight to the host, same as Ultimate Hold'em. See `p2p/core.js`. If the host closes the page the table pauses until they come back; a refresh is fine.
