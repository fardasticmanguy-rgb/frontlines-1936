# Frontlines 1936

A four-player grand strategy game for tablets, inspired by Hearts of Iron. Everyone plans their moves in secret, then all orders resolve at the same time.

**Play:** https://fardasticmanguy-rgb.github.io/frontlines-1936/

## Features

- **Play on this device**: pick the map, 2 to 8 nations, map size, AI difficulty, war length, winter and world events
- **Pass-and-play**: mark several nations as players and hand the device around; plans stay secret behind a handoff screen
- **Europe 1939**: real cities and coastlines, sea crossings, Germany, Britain, France, USSR, Italy, Poland, Spain and Turkey, neutral minors, and the Axis and Allies already formed
- **Random continents**: procedurally generated Voronoi maps from a shared seed, small to large
- Simultaneous turns with deterministic combat: no dice, terrain and forts multiply defense
- Supply lines: provinces cut off from your cities are weakened and lose divisions every turn
- Seasons: winter (Dec–Feb) weakens every offensive
- National traits: Blitzkrieg, Industrial Base, Mass Mobilization, Fortress Doctrine, General Winter, Mountain Troops
- Diplomacy: factions of up to half the nations, invitations, betrayals, and sending aid; factions win together
- Factories upgrade to level 3 and lose a level when captured
- World events (strikes, booms, volunteers, partisans, harvests) and a monthly report
- Online play for up to 8 players over WebRTC, with public and private lobbies and the same map settings
- Empty or disconnected seats are taken over by an AI; players can rejoin and hosts can resume
- Touch-first controls: drag to attack, pinch to zoom, auto-rotating map on portrait screens

## How it works

The host's browser is authoritative. Guests send their orders, the host validates them and resolves the turn, then broadcasts the new state. Maps are generated from a seed with integer-safe math, so every client builds the same map locally and only the state is sent over the network.

| Module                   | Responsibility                                |
| ------------------------ | --------------------------------------------- |
| `js/map.js`              | Random map generation                         |
| `js/scenarios/europe.js` | Europe 1939 map, powers and starting setup    |
| `js/setup.js`            | New war settings screen                       |
| `js/rules.js`            | Turn resolution, economy, victory             |
| `js/ai.js`               | AI opponents                                  |
| `js/codec.js`            | Network state encoding                        |
| `js/online.js`           | Lobbies, host/guest sync, reconnects          |
| `js/net/`                | PeerJS room adapter and public game directory |
| `js/render.js`           | Canvas map rendering                          |

## Development

```bash
npm install
npm start       # serve on http://localhost:8080
npm test        # rules, map and codec tests
npm run build   # single-file build in dist/
```
