<div align="center">

<img src="build/icon.png" width="128" height="128" alt="Puxl Launcher" />

# Puxl Launcher

**A fast, good-looking Minecraft: Java Edition launcher with a real mod manager, a performance tuner and downloads that work on restricted networks.**

[![Build](https://github.com/amingangmanatgh2-hash/Puxl-10/actions/workflows/build.yml/badge.svg)](../../actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/amingangmanatgh2-hash/Puxl-10?include_prereleases&sort=semver)](../../releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-7c5cff.svg)](LICENSE)

</div>

---

## What it is

Puxl replaces the official launcher with something that actually helps you: it installs any Minecraft version with
Fabric, Quilt, Forge or NeoForge, finds the right Java runtime by itself, manages mods through the Modrinth API,
tunes the JVM and in-game graphics for your exact hardware, and routes downloads through mirrors so they survive
bad international connectivity.

It is **not** a cheat client. See [What Puxl will never do](#what-puxl-will-never-do).

## Features

### Launcher
- **Instances/profiles** — each one has its own game folder, mods, worlds, memory, JVM arguments and window size.
- **Automatic installation** — version json, client jar, every library, every native, the full asset set, and the
  matching Java runtime (8 / 17 / 21) downloaded and verified by SHA-1, with resume and retry.
- **All four loaders** — Fabric, Quilt and NeoForge installed straight from their metadata APIs; Forge and NeoForge
  through their own CLI installer, run automatically with the correct Java.
- **Accounts** — Microsoft device-code sign-in (OAuth, your password never touches the launcher) and offline profiles
  with deterministic UUIDs for singleplayer/LAN.
- **Console** — the live game log, in the app, with the exact command line available for troubleshooting.
- **Command palette** — `Ctrl/⌘ + K` to jump to an instance, a page, a setting, or search Modrinth directly.
- **Self-updates** — checks the GitHub releases API on startup (through the same mirrors/proxy as everything else),
  shows a banner when a newer version exists, downloads the installer with resume support, then restarts to install.
  Portable copies are told to swap the file instead of pretending to self-update.

### Mod manager
- Browse and search **Modrinth**, pre-filtered to builds that actually run on the selected instance.
- **Dependencies resolved recursively**, existing files replaced instead of duplicated, checksum verified.
- Enable/disable by toggle, delete, **update detection**, and "Add jar" for files you downloaded elsewhere.
- **Performance pack** — one click installs Sodium + Lithium + FerriteCore + Krypton + ImmediatelyFast + EntityCulling +
  More Culling + Dynamic FPS + BadOptimizations (+ Iris as optional), or Embeddium + ModernFix + Canary + Saturn on
  Forge/NeoForge. The list adapts to the loader and Minecraft version.
- **Resource packs and shaders** installed into the right folder the same way.
- **Modpacks** — import any `.mrpack` from disk or from a link; mods, configs and overrides land in the instance.

### Performance
- Hardware scan (CPU threads, RAM, GPU + VRAM) with a tier rating and a recommended memory value.
- Tuned G1GC flag set sized to the allocated heap; small heaps get a deliberately shorter list.
- Five **graphics presets** written into `options.txt` without destroying your keybinds or unrelated settings.
- "Optimise everything" — memory, graphics preset and performance mods in one action.
- Pre-launch **health checks**: over-allocation, crash reports, mod folder size, missing files.

### Updates
- Startup check against the GitHub releases API with proxy fallbacks (`api.github.com` → `gh-proxy.com` → `ghfast.top`).
- Download uses the mirrored, resumable downloader, so a blocked GitHub still works through a proxy prefix.
- Installer runs silently (`/S`) after the launcher closes; the portable build reveals the new exe instead.
- The proxy you configure is applied to Electron's own session too, so update checks and remote mod icons honour it.

### Network (built for Iran and other restricted networks)
- Three mirror modes: official first, **mirrors first**, or direct only.
  - Mojang metadata/data, libraries, assets and Forge/Fabric mavens → **BMCLAPI** (`bmclapi2.bangbang93.com`).
  - GitHub releases/raw → GitHub reverse proxies.
- **Custom mirror rules**: rewrite any URL prefix to your own mirror.
- **Proxy support** for every request (http/https/socks5 via undici), plus an optional separate proxy for the assistant.
- Bounded-concurrency downloader with per-file resume, retry on a different mirror, and SHA-1 verification.
- Everything it downloads is a plain file: you can point Puxl at an existing `.minecraft` folder.

### Assistant
- Built-in chat that is **grounded in your setup** — it can read the active instance, its mod list, `latest.log` and the
  newest crash report when you allow it (nothing is read otherwise).
- Uses the **Gemini API** with your own free key, streaming responses.
- Works **offline** from a built-in knowledge base (crashes, FPS, mod conflicts, Java, downloads) when no key is set.
- If Google is unreachable from your network, point it at your own relay/Worker base URL or give it a proxy.

## Install

Download the latest `Puxl-Launcher-*-x64.exe` from [Releases](../../releases).

- The **installer** lets you choose the install directory and creates desktop/Start Menu shortcuts.
- A **portable** build is published alongside it if you prefer no installation.
- Release installers are built automatically by GitHub Actions from tagged commits.

> Prefer not to run a prebuilt binary? Build it yourself in one command, see below.

## Build from source

Requires Node.js 20+.

```bash
git clone https://github.com/amingangmanatgh2-hash/Puxl-10
cd Puxl-10
npm install
npm run dev          # run the launcher with hot reload
npm run verify       # typecheck + smoke tests + production bundle
npm run dist:win     # build the Windows installer and portable exe into dist/
```

Two headless suites run in CI on every push:

- `npm run smoke` — launcher logic that breaks silently in production: Mojang rule evaluation, library/native
  resolution across platforms, version inheritance, argument flattening, mirror rewriting, JVM tuning, `options.txt`
  merging, offline UUIDs and the mod registry.
- `npm run smoke:ipc` — the full IPC surface (67 channels) driven exactly like the UI drives it, asserting on
  instance CRUD, account validation, mod listing/toggling, health checks, disk usage, launch guards, update
  handling and the offline assistant.

## How the pieces fit

```
src/
  main/         Electron main process — the whole backend
    net.ts        mirrored/retrying/resumable downloader + progress hub
    mojang.ts     version manifest, rules, libraries, natives, assets
    loaders.ts    Fabric, Quilt, Forge, NeoForge installation
    java.ts       runtime detection, Mojang runtime download, Temurin fallback
    launch.ts     classpath, arguments, JVM flags, process management
    mods.ts       Modrinth search/install/dependencies/updates, packs, content
    accounts.ts   Microsoft device-code OAuth, offline profiles
    perf.ts       hardware scan, JVM tuning, graphics presets, health checks
    assistant.ts  Gemini (streaming) + offline knowledge base + crash analysis
    updater.ts    release check, mirrored download and silent install of new versions
    ipc.ts        the typed bridge the UI talks to
  preload/      contextBridge surface (no node in the renderer)
  renderer/     React 19 + Tailwind 4 UI
    views/        Instances, Mods, Performance, Accounts, Assistant, Settings
    components/   title bar, sidebar, command palette (Ctrl+K), toasts
```

## What Puxl will never do

Puxl is a launcher. It contains no combat modules, no world manipulation, no ESP/x-ray, no HWID spoofer, no
anti-cheat bypass, no fake-stat injection and no server-side griefing tools — and it never will. Ban evasion and
cheating tools harm other players and violate the rules of every server worth playing on. If you were banned, the
supported path is appealing the ban or playing somewhere else.

The launcher also refuses to help with that by design: it has no injection hooks, no memory patching and no process
tampering.

## Legal

Not affiliated with Mojang, Microsoft, Modrinth, Fabric or Forge. Minecraft is a trademark of Mojang Synergies AB.
Game files are downloaded from Mojang's public launcher endpoints (or mirrors you configure) and mods from the
public Modrinth API.

MIT licensed — see [LICENSE](LICENSE).
