# IITM Craft

A Minecraft-style voxel game of the **IIT Madras** campus, built with [three.js](https://threejs.org). It's a single HTML file with no build step and no image assets.

The campus layout follows the institute's published *Layout of Buildings* map (July 2021), scaled to about 5 m per block. Bonn Avenue and Delhi Avenue run from the Main Gate down to Gajendra Circle, with the academic zone to the west, the hostel zone to the south, the lakes in the eastern forest, and the Research Park beyond the RP ramp.

> Fan-made project, not affiliated with IIT Madras.

## Play
Open `index.html` in Chrome, Edge or Firefox on a desktop. It needs an internet connection the first time to load three.js and the fonts.

## What's on campus
**85 places**, each with a signboard, including:
- **Gates:** Main Gate, Velachery Gate, Taramani Gate
- **Academic zone:** Gajendra Circle, Administrative Block, Central Library, HSB, CLT, MSB, ESB, New Academic Complex I and II, IC&SR, CFI, department buildings, hospital, Chemplast Cricket Ground, sports fields
- **Hostel zone:** all the major hostels (Mandakini, Sindhu, Pampa, Tamiraparani, Mahanadhi, Ganga, Jamuna, Narmada, Godavari, Cauvery, Krishna, Brahmaputra and more), Himalaya, Vindhya and Nilgiri messes, OAT, SAC, swimming pool, Sangam Ground
- **Residential zone:** Vanavani School, Kendriya Vidyalaya, Watsa Stadium, temples, Shopping Centre, banks, staff quarters, Campus Lake
- **IITM Research Park**

## Goals
- Discover all 85 places
- Greet 12 deer (spotted deer and blackbuck). Approach slowly, because sprinting scares them

## Controls
| Key | Action |
|---|---|
| `WASD` | Move |
| `Space` | Jump / swim / fly up |
| `Shift` | Sprint / fly down |
| `F` | Toggle flying |
| `M` | Campus map (click a discovered place to travel there) |
| `T` | Switch between day and night |
| Left click | Break a block / greet a deer |
| Right click | Place a block |
| Middle click | Pick a block |
| `1-9` / scroll | Choose a block |
| `Esc` | Pause |

## Tech notes
- 480 × 528 × 48 voxel world in 16×16 chunks, face culling and per-vertex ambient occlusion
- Procedural 16 px texture atlas drawn at startup
- Buildings are auto-placed near their map coordinates without overlapping roads or each other
- `index.html?debug` exposes `window.iitm` for automated testing

See [PLAN.md](PLAN.md) for the roadmap.
