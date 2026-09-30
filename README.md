# IITM Craft

A multiplayer voxel game of the **IIT Madras** campus, built with [three.js](https://threejs.org) and a small Node.js WebSocket server.

Walk the campus as a student, ride the e-buggies and bicycles, meet the deer and monkeys, and chat with other players who are online at the same time.

The layout follows the institute's published *Layout of Buildings* map (July 2021), scaled to about 5 m per block: Bonn Avenue and Delhi Avenue run from the Main Gate to Gajendra Circle, the academic zone is to the west, the hostel zone to the south, the lakes are in the eastern forest, and the Research Park lies beyond the RP ramp.

> Fan-made project, not affiliated with IIT Madras.

## Run it
```bash
npm install
npm start            # http://localhost:8787
```
Open the address in a desktop browser, enter a name, pick a boy or girl student and start exploring. Open a second tab (or share the address on your network) to see multiplayer in action.

Opening `index.html` directly also works for single-player; it tries to connect to `localhost:8787` and plays offline if no server is running.

## Features
- **85 campus places**, each with a signboard: gates, departments, all the major hostels, messes, OAT, SAC, grounds, temples, schools, banks, Research Park
- **Third-person student**, boy or girl, with walk, run, jump and fly animations
- **18 e-buggies** at campus stops and **90+ bicycles** at hostel and academic stands
- **60 deer** (spotted deer and blackbuck) and **40 bonnet macaques**
- **Multiplayer:** live player count, name tags, smooth movement, shared vehicles (one rider at a time)
- **Chat:** walk up to someone, press `E` to send a request; if they accept, a chat window opens for both
- **Campus map** with fast travel to places you've discovered
- Day/night cycle, and automatic quality scaling on slower machines

## Controls
On phones and tablets: left stick to walk or drive, drag to look around, and the **Use / Jump / Run / Fly** buttons. Pause and the map are in the top-right corner.

On a computer:

| Key | Action |
|---|---|
| `WASD` | Walk / drive |
| Mouse | Look around (click the game to capture the mouse) |
| `Space` | Jump · brake while driving |
| `Shift` | Sprint |
| `E` | Drive, ride, greet a deer, wave at a monkey, or start a chat |
| `H` | Horn (e-buggy) or bell (bicycle) |
| `F` | Toggle flying |
| `M` | Campus map |
| `T` | Switch between day and night |
| `G` | Send the plane back to its airstrip if it gets stuck |
| Scroll | Camera zoom |
| `Enter` / `X` | Type a chat message / end the chat |
| `Y` / `N` | Accept / decline a chat request |
| `Esc` | Pause |

## Tests
```bash
npm test
```
Runs 81 end-to-end checks with Playwright against a fresh server: world generation, walking, jumping, collisions, discovery, the map, driving and cycling, wildlife, flying, day/night, two-player presence, movement sync, chat request/accept/decline/messages, vehicle occupancy, leaving, and server input validation and rate limiting.

## How it works
- `index.html`: the whole client (world generation, meshing, gameplay, UI, networking)
- `server/server.js`: serves the page, and relays positions at 10 Hz, vehicle occupancy and 1:1 chat
- The server validates every message: names are sanitised, positions must be inside the world, chat only flows between players who both agreed, and clients that flood messages are disconnected

## Deploying
Any Node host with WebSocket support works (Render, Railway, Fly.io, a VPS). Use `npm start` as the start command; the server reads `PORT` from the environment. `MAX_PLAYERS` (default 150) caps concurrent players.

```bash
npm run deploy:check           # what is live, who is online — changes nothing
npm run deploy                 # push, deploy, wait until the new build is serving
npm run deploy -- --quiet-at 2 # wait for a quiet moment (<= 2 players) first
```

### Deploying without disturbing players
A deploy restarts the process, so the WebSocket connection has to drop. What players must never
get is a dead game and a "reload the page" moment. So:

- The server catches `SIGTERM` (what the host sends first) and tells everyone it is a **quick
  update** before closing the sockets politely, instead of letting them die silently.
- The client keeps the whole campus running — the world is generated locally, so play continues.
  The status pill reads *Updating*, and a note explains no reload is needed.
- It reconnects on its own, starting about a second later, backing off gently and **jittered** so
  a roomful of players doesn't hit a cold server all at once. Once back, it re-takes the vehicle
  seat it had and says *Back online*.
- A connection that arrives mid-restart is told to wait rather than dropped into a dying world.
- `/api/version` reports the commit that is actually serving, so `npm run deploy` can wait for the
  new build and report the real gap rather than guessing.

Typical result: a few seconds of *Updating* with the game still running, and nobody has to touch
anything.

See [PLAN.md](PLAN.md) for the roadmap.
