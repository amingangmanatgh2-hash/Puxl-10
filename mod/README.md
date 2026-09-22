# Puxl QoL

One client-side quality-of-life mod for Minecraft, built for the Puxl launcher and usable with
any launcher. Every loader build shares the same sources in `common/`; only the small bootstrap
class and the build file differ per loader.

| Module | Loader | Minecraft | Jar name |
| --- | --- | --- | --- |
| `fabric-1.21.1` | Fabric and Quilt (Quilted Fabric API required) | 1.21.1 | `puxl-qol-fabric-1.21.1-<version>.jar` |
| `fabric-1.20.1` | Fabric and Quilt (Quilted Fabric API required) | 1.20.1 | `puxl-qol-fabric-1.20.1-<version>.jar` |
| `neoforge-1.21.1` | NeoForge | 1.21.1 | `puxl-qol-neoforge-1.21.1-<version>.jar` |
| `forge-1.20.1` | Forge | 1.20.1 | `puxl-qol-forge-1.20.1-<version>.jar` |

Nothing here touches gameplay, world state or the network: the mod is a client-side overlay and
setting helper, and it can be removed at any time without leaving anything behind except its own
config files in `config/`.

## Features

**HUD** (press the HUD keybind to hide it entirely)

- Real measured FPS with 1% low frame time and a 30 second graph, highlighted when it drops.
- Coordinates, chunk position, facing with degrees, biome, dimension, in-game time, light level.
- Ping, server address, RAM usage, loaded chunks, entity count, session time, movement speed.
- Waypoint compass: the nearest waypoint in this dimension, its distance and direction, plus an
  on-screen marker that follows where you are looking.
- Placement in any corner, with scale, line spacing, panel and colour options.

**Zoom** — hold the zoom key for a smooth optical zoom, scroll while zoomed to walk it between your
configured limits, with an optional sensitivity reduction. The field of view is restored exactly when
you release the key.

**Waypoints** — save the spot you are standing on, name it, colour it, delete it, copy its
coordinates, clear a whole dimension, and optionally save a temporary marker automatically when you
die. Stored per save in `config/puxl-qol-waypoints.json`.

**Chat and handy tools** — optional `[HH:mm]` timestamps, a scrollback limit above the vanilla 100
lines, copy the last chat line, copy your coordinates with one key, and open the screenshots folder.

**Automatic performance optimiser** — watches the real frame rate over a sampling window and, only
when it stays below your target, walks the vanilla graphics settings down step by step: particles,
entity distance, entity shadows, render distance, simulation distance. When there is headroom again it
walks them back up, never past the values you had before it touched anything. Every change is paced by
a cooldown, the first seconds after joining a world are ignored, and turning the feature off restores
your original settings.

**In-game settings** — press `P` for six tabs (HUD, Zoom, Waypoints, Chat, Optimizer, About). The
config is plain JSON in `config/puxl-qol.json` and is repaired with defaults if it is edited badly.

Default keybinds (all rebindable in the vanilla controls screen):

| Key | Action |
| --- | --- |
| `P` | Open the Puxl settings screen |
| `C` | Zoom (hold) |
| `H` | Toggle the HUD |
| `N` | Add a waypoint where you stand |
| `M` | Remove the nearest waypoint |
| `J` | Copy your coordinates |
| `K` | Copy the last chat message |
| `O` | Open the screenshots folder |

## Building

The build needs network access to the loader Mavens, which the development sandbox does not have,
so `mod/` is compiled by GitHub Actions (`.github/workflows/mod.yml`). Locally, with Gradle 8.14 and
a JDK 21 plus a JDK 17 available:

```bash
cd mod
gradle -p fabric-1.21.1 build
gradle -p fabric-1.20.1 build
gradle -p neoforge-1.21.1 build
gradle -p forge-1.20.1 build
```

Every module is a standalone Gradle build (its own `settings.gradle`) that pulls in the shared
sources from `../common`, so one loader's toolchain can never disturb another's. Jars land in
`mod/<module>/build/libs`, and the bytecode level follows the Minecraft generation (21 for 1.21.1,
17 for 1.20.1) while the build itself runs on JDK 21. Tagging a commit `mod-v1.0.0` and pushing the tag runs
`.github/workflows/mod-release.yml`, which builds all four jars and attaches them to a GitHub
release — the same host the launcher downloads from, so the files stay reachable from Iran.
