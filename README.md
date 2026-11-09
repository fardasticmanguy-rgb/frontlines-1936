# Frontlines 1936

A four-player grand strategy game for tablets, inspired by Hearts of Iron. Everyone plans their moves in secret, then all orders resolve at the same time.

**Play:** https://fardasticmanguy-rgb.github.io/frontlines-1936/

## Features

- Procedurally generated continent (~90 Voronoi provinces, terrain, 22 cities) from a shared seed
- Simultaneous turns with deterministic combat: no dice, terrain and forts multiply defense
- Supply lines: provinces cut off from your cities are weakened and lose divisions every turn
- Seasons: winter (Dec–Feb) weakens every offensive
- Asymmetric nations: Blitzkrieg, Industrial Base, Mass Mobilization and Fortress Doctrine
- World events (strikes, booms, volunteers, partisans, harvests) and a monthly report
- Alliances: offer a pact by tapping a flag; allies share supply, fight together and win together
- Factories upgrade to level 3 and lose a level when captured
- Online play for up to 4 players over WebRTC, with public and private lobbies
- Empty or disconnected seats are taken over by an AI; players can rejoin and hosts can resume
- Touch-first controls: drag to attack, pinch to zoom, auto-rotating map on portrait screens

## How it works

The host's browser is authoritative. Guests send their orders, the host validates them and resolves the turn, then broadcasts the new state. Maps are generated from a seed with integer-safe math, so every client builds the same map locally and only the state is sent over the network.

| Module         | Responsibility                                |
| -------------- | --------------------------------------------- |
| `js/map.js`    | Map generation                                |
| `js/rules.js`  | Turn resolution, economy, victory             |
| `js/ai.js`     | AI opponents                                  |
| `js/codec.js`  | Network state encoding                        |
| `js/online.js` | Lobbies, host/guest sync, reconnects          |
| `js/net/`      | PeerJS room adapter and public game directory |
| `js/render.js` | Canvas map rendering                          |

## Development

```bash
npm install
npm start       # serve on http://localhost:8080
npm test        # rules, map and codec tests
npm run build   # single-file build in dist/
```
