# BF6-Fork: Outpost Alpha — Modular Destruction & Combined-Arms Prototype

A Battlefield 6-inspired tactical combined-arms Conquest prototype built with **Blender 5.3** (procedural Python BMesh + NumPy PBR asset pipeline) and **Three.js + TypeScript + Vite**.

## Highlights

- **29 Custom 1:1 Metric `.glb` Tactical Assets** (`public/models/`) + **27 Procedural Packed PBR Material Sets**:
  - **18 Modular Destructible Buildings & Military Fortifications** (`env/`): Voronoi interlocking wall chunks (`Chunk_01..06`) with hidden twisted rebar cores, walkable 14-step interior staircases, Hesco bastions, shipping containers, sandbags, Czech hedgehogs, and Conquest flagpoles.
  - **5 Infantry Weapons & Demolition Gadgets** (`weapons/`): `M5A3` Tactical Carbine (true 3D holographic sight reticle & reciprocating bolt), `RPG-7V2` Anti-Tank Launcher, `M2010 ESR` .300 WinMag Sniper, Sticky `C4 Breach Pack`, and `Clacker Detonator`.
  - **3 Articulated Land & Air Vehicles** (`vehicles/`): `M1A2 AbramsX` Main Battle Tank (360° turret, 120mm cannon, CROWS HMG, wall ramming), `AH-6J Little Bird` Attack Helicopter (cyclic/collective flight, auto-level hover, dual M134 miniguns, 70mm Hydra rocket pods), and `LATV4` 4x4 Recon Buggy (steerable/spinning wheels + roof `.50` cal HMG).
  - **3 Skinned & NLA-Animated Character Rigs** (`characters/`): `CHR_Soldier_NATO_Assault`, `CHR_Soldier_PAX_OpFor`, and `CHR_FPS_Arms_Rig` (tactical sleeves, illuminated GPS wristwatch, carbon-knuckle gloves).
- **Conquest Large Sandbox Gameplay**:
  - 3 capturable Conquest sectors (`ALPHA`, `BRAVO`, `CHARLIE`) with faction ticket bleed (`300 vs 300`).
  - Real-time wall chunk breaching, flying rigid-body debris, persistent ground rubble piles, and sticky C4 on moving vehicles.
  - 18 autonomous skinned AI soldiers (`NATO` vs `PAX`) + enemy tank patrol + procedural WebAudio gunfire/explosion synthesis.
  - **Responsive Desktop & Mobile Browser Support**: Full multi-touch twin-stick controls (virtual movement thumbstick + auto-sprint, right-screen look + hold-and-drag fire, tappable weapon slots, dedicated vehicle touch HUD, `100dvh` & safe-area-inset adaptation for portrait/landscape smartphones).

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173/` to deploy!

### Regenerating 3D Assets in Blender (Optional)

All `.glb` models in `public/models/` are pre-exported and ready to run. To rebuild from source in Blender 5.0+:

```bash
blender --background --python scripts/blender/build_all.py
```
