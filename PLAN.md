# IITM Craft — Game Plan

A Minecraft-style voxel game set on the IIT Madras campus. It runs in any desktop browser from a single `index.html` file, with no build step. It uses three.js and procedural pixel textures, so there are no image assets.

## Vision
Explore a blocky IIT Madras, find its landmarks, befriend the deer that roam the forest campus, and build whatever you want.

## Core loop
1. Spawn outside the **Main Gate**.
2. Explore and discover **7 landmarks**. Each one shows a fun fact.
3. Sneak up on **deer** and greet 8 of them. Sprinting scares them off.
4. Build and break blocks freely: a full sandbox.

## ✅ v1: done
| Area | What's in |
|---|---|
| World | 160×160×48 voxel world, chunked meshing (16×16), face culling |
| Campus | Main Gate + campus wall, Gajendra Circle (with elephant), Central Library, Himalaya Mess, Ganga / Jamuna / Cauvery hostels, Open Air Theatre, Campus Lake + jetty, roads with street lamps, forest |
| Player | First-person pointer-lock controls, gravity, AABB collision, auto-step, swimming, fly mode |
| Building | Break / place / pick blocks, 9-slot hotbar, 17 block types |
| Life | Deer AI (spotted deer + blackbuck): wander, graze, flee, greet with hearts |
| Atmosphere | Day/night cycle, glowing lamps at night, fog, drifting clouds, landmark labels |
| Quest | Landmark discovery + deer goal, toasts, win message |

## 🔜 v2: next up
- [ ] Save/load world edits (localStorage)
- [ ] Sounds: footsteps, block break/place, ambient birds, night crickets
- [ ] Monkeys that steal items from your hotbar 🐒
- [ ] More landmarks: Research Park, SAC, KV School, Taramani gate
- [ ] Interiors: stairs between floors, library reading desks
- [ ] Cycles to ride around campus 🚲

## 🌟 v3: ideas
- [ ] Multiplayer campus (WebSocket rooms)
- [ ] Saarang / Shaastra event mode: build a stage at the OAT
- [ ] Mobile touch controls
- [ ] Minimap

## Performance rules
- Rebuild only the chunks you edit, not the whole world
- Keep draw calls low: 2 meshes per chunk (opaque + transparent)
- Nearest-filter atlas, no mipmaps, pixel ratio capped at 1.5
- Fixed-step physics substeps to avoid tunneling at low FPS
