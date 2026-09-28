# 🧱 IITM Craft

A Minecraft-style voxel game set on the **IIT Madras** campus, built with [three.js](https://threejs.org). It's one HTML file with no build step and no assets.

> Fan-made project, not affiliated with IIT Madras.

## ▶️ Play
Open `index.html` in Chrome, Edge or Firefox on a desktop. It needs an internet connection the first time to load three.js from a CDN.

Or serve it locally:
```bash
npx serve .
```

## 🎯 Goals
- 📍 Discover **7 landmarks**: Main Gate, Gajendra Circle, Central Library, Open Air Theatre, Himalaya Mess, Hostel Zone, Campus Lake
- 🦌 Greet **8 deer**. Walk up slowly, because sprinting scares them away
- 🧱 Build anything you like

## 🎮 Controls
| Key | Action |
|---|---|
| `WASD` | Move |
| `Space` | Jump / swim up / fly up |
| `Shift` | Sprint / fly down |
| `F` | Toggle fly mode |
| Left click | Break block / greet deer |
| Right click | Place block |
| Middle click | Pick block |
| `1-9` / scroll | Choose block |
| `T` | Skip to day / night |
| `Esc` | Pause |

## 🛠️ Tech
- three.js r160 through an import map
- Procedural 16×16 pixel-art texture atlas drawn on a canvas at startup
- Chunked voxel meshing with face culling, rebuilding only edited chunks
- Voxel DDA raycasting for block picking

See [PLAN.md](PLAN.md) for the roadmap.
