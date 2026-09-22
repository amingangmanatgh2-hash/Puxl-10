/**
 * Headless smoke test for the launcher's pure logic.
 *
 * Runs without Electron by aliasing `electron` to a stub (see scripts/electron-stub.js),
 * covering the parts that break silently in production: rule evaluation, library and
 * native resolution, argument flattening, mirror rewriting, JVM tuning and options.txt.
 *
 *   npm run smoke
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveUrls } from '../src/main/net'
import { setRootOverride, paths, ensureDirs } from '../src/main/paths'
import { loadSettings, saveSettings } from '../src/main/store'
import {
  buildDownloadPlan,
  findClientJarOwner,
  flattenArguments,
  resolveLibraries,
  resolveInherited,
  rulesAllow,
  versionDir,
  versionJsonPath,
  type VersionDetails
} from '../src/main/mojang'
import { loaderVersionId } from '../src/main/installer'
import { requiredJavaMajor } from '../src/main/java'
import { applyGraphicsPreset, optionsForPreset, perfModsFor, readOptions, recommendMemory, tuneJvmArgs } from '../src/main/perf'
import { offlineUuid, validateName } from '../src/main/accounts'
import { listInstalledMods, readRegistry } from '../src/main/mods'
import { defaultInstance } from '../src/main/instances'

let passed = 0
let failed = 0

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  \u001b[32m✓\u001b[0m ${name}`)
    })
    .catch((err: unknown) => {
      failed++
      console.log(`  \u001b[31m✗\u001b[0m ${name}`)
      console.log(`      ${err instanceof Error ? err.message : String(err)}`)
    })
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'puxl-smoke-'))

async function main(): Promise<void> {
  setRootOverride(tmpRoot)
  ensureDirs()

  console.log(`\nPuxl smoke tests — root ${tmpRoot}\n`)

  console.log('rules')
  await test('empty rules allow everything', () => {
    assert.equal(rulesAllow(undefined, {}), true)
    assert.equal(rulesAllow([], {}), true)
  })
  await test('os rules only match the running platform', () => {
    const windowsOnly = [{ action: 'allow' as const, os: { name: 'windows' as const } }]
    assert.equal(rulesAllow(windowsOnly, {}), process.platform === 'win32')
  })
  await test('disallow after allow wins', () => {
    const rules = [{ action: 'allow' as const }, { action: 'disallow' as const, os: { name: process.platform === 'win32' ? ('windows' as const) : ('linux' as const) } }]
    assert.equal(rulesAllow(rules, {}), process.platform === 'darwin')
  })
  await test('feature rules respect the feature set', () => {
    const rules = [{ action: 'allow' as const, features: { has_custom_resolution: true } }]
    assert.equal(rulesAllow(rules, { has_custom_resolution: true }), true)
    assert.equal(rulesAllow(rules, { has_custom_resolution: false }), false)
  })

  console.log('\nargument flattening')
  await test('string and object arguments flatten in order', () => {
    const args = flattenArguments(
      ['--username', { value: '--demo' }, { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo-hidden' }, { value: ['--width', '854'] }],
      {}
    )
    assert.deepEqual(args, ['--username', '--demo', '--width', '854'])
  })

  console.log('\nlibrary resolution')
  const syntheticVersion: VersionDetails = {
    id: '1.20.1-test',
    mainClass: 'net.minecraft.client.main.Main',
    assets: '5',
    downloads: {
      client: { sha1: 'abc', size: 100, url: 'https://piston-data.mojang.com/v1/objects/abc/client.jar' }
    },
    libraries: [
      {
        name: 'org.ow2.asm:asm:9.5',
        downloads: {
          artifact: { path: 'org/ow2/asm/asm/9.5/asm-9.5.jar', sha1: 'ff', size: 10, url: 'https://libraries.minecraft.net/org/ow2/asm/asm/9.5/asm-9.5.jar' }
        }
      },
      {
        name: 'org.lwjgl:lwjgl:3.3.2:natives-windows',
        downloads: {
          artifact: {
            path: 'org/lwjgl/lwjgl/3.3.2/lwjgl-3.3.2-natives-windows.jar',
            sha1: 'ee',
            size: 20,
            url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.2/lwjgl-3.3.2-natives-windows.jar'
          }
        },
        rules: [{ action: 'allow', os: { name: 'windows' } }]
      },
      {
        name: 'org.lwjgl:lwjgl:3.3.2:natives-linux',
        downloads: {
          artifact: {
            path: 'org/lwjgl/lwjgl/3.3.2/lwjgl-3.3.2-natives-linux.jar',
            sha1: 'dd',
            size: 20,
            url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.2/lwjgl-3.3.2-natives-linux.jar'
          }
        },
        rules: [{ action: 'allow', os: { name: 'linux' } }]
      },
      {
        // Legacy style natives map (pre-1.19).
        name: 'org.lwjgl:lwjgl-platform:2.9.4',
        natives: { windows: 'natives-windows', linux: 'natives-linux', osx: 'natives-osx' },
        downloads: {
          artifact: { path: 'org/lwjgl/lwjgl-platform/2.9.4/lwjgl-platform-2.9.4.jar', sha1: 'aa', size: 5, url: 'https://libraries.minecraft.net/x.jar' },
          classifiers: {
            'natives-windows': { path: 'org/lwjgl/lwjgl-platform/2.9.4/lwjgl-platform-2.9.4-natives-windows.jar', sha1: 'bb', size: 6, url: 'https://libraries.minecraft.net/nat-windows.jar' },
            'natives-linux': { path: 'org/lwjgl/lwjgl-platform/2.9.4/lwjgl-platform-2.9.4-natives-linux.jar', sha1: 'cc', size: 6, url: 'https://libraries.minecraft.net/nat-linux.jar' },
            'natives-osx': { path: 'org/lwjgl/lwjgl-platform/2.9.4/lwjgl-platform-2.9.4-natives-osx.jar', sha1: 'cd', size: 6, url: 'https://libraries.minecraft.net/nat-osx.jar' }
          }
        }
      },
      {
        // A mod-loader library with no downloads block: URL must be derived from `url`.
        name: 'net.fabricmc:sponge-mixin:0.12.5+mixin.0.8.5',
        url: 'https://maven.fabricmc.net/'
      }
    ]
  }

  await test('modern natives are detected as native jars', () => {
    const libs = resolveLibraries(syntheticVersion.libraries, {})
    const natives = libs.filter((l) => l.isNative)
    const expected = process.platform === 'win32' ? 2 : process.platform === 'darwin' ? 1 : 2
    assert.equal(natives.length, expected)
    assert.ok(natives.some((n) => n.path.includes('-natives-')) || natives.some((n) => n.artifact === 'lwjgl-platform'))
  })
  await test('platform rules filter out other OS libraries', () => {
    const libs = resolveLibraries(syntheticVersion.libraries, {})
    const wrongPlatform = libs.filter((l) => l.path.includes('-natives-') && !l.path.includes(nativeTag()))
    assert.equal(wrongPlatform.length, 0)
  })
  await test('plain libraries stay on the classpath', () => {
    const libs = resolveLibraries(syntheticVersion.libraries, {})
    const asm = libs.find((l) => l.artifact === 'asm')
    assert.ok(asm)
    assert.equal(asm?.isNative, false)
  })
  await test('libraries without downloads get a maven URL from the group id', () => {
    const libs = resolveLibraries(syntheticVersion.libraries, {})
    const fabric = libs.find((l) => l.group === 'net.fabricmc')
    assert.ok(fabric, 'fabric library should resolve')
    assert.equal(fabric?.url, 'https://maven.fabricmc.net/net/fabricmc/sponge-mixin/0.12.5+mixin.0.8.5/sponge-mixin-0.12.5+mixin.0.8.5.jar')
  })

  console.log('\ndownload planning')
  await test('plan covers client jar, libraries and asset index', async () => {
    const plan = await buildDownloadPlan({
      instanceId: '1.20.1-test',
      clientJarOwner: '1.20.1-test',
      gameDir: path.join(tmpRoot, 'instances', 'demo'),
      details: syntheticVersion,
      settings: loadSettings(),
      skipAssets: true
    })
    assert.ok(plan.tasks.some((t) => t.dest.endsWith('.jar') && t.dest.includes('1.20.1-test')))
    assert.ok(plan.tasks.some((t) => t.url.includes('libraries.minecraft.net')))
    assert.equal(plan.clientJar, path.join(versionDir('1.20.1-test'), '1.20.1-test.jar'))
  })
  await test('client jar owner follows inheritsFrom to the vanilla json', async () => {
    const loaderJson: VersionDetails = {
      id: 'fabric-loader-0.15.0-1.20.1',
      inheritsFrom: '1.20.1-test',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      assets: '5',
      downloads: {},
      libraries: []
    }
    fs.mkdirSync(versionDir('1.20.1-test'), { recursive: true })
    fs.writeFileSync(versionJsonPath('1.20.1-test'), JSON.stringify(syntheticVersion))
    fs.mkdirSync(versionDir('fabric-loader-0.15.0-1.20.1'), { recursive: true })
    fs.writeFileSync(versionJsonPath('fabric-loader-0.15.0-1.20.1'), JSON.stringify(loaderJson))

    assert.equal(await findClientJarOwner(loaderJson), '1.20.1-test')
    const merged = await resolveInherited(loaderJson)
    assert.equal(merged.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient')
    assert.equal(merged.downloads.client?.url, syntheticVersion.downloads.client?.url)
    assert.ok(merged.libraries.length >= syntheticVersion.libraries.length)
  })

  console.log('\nversion ids and java')
  await test('loader version ids match the official launcher format', () => {
    assert.equal(loaderVersionId('fabric', '1.20.1', '0.15.0'), 'fabric-loader-0.15.0-1.20.1')
    assert.equal(loaderVersionId('quilt', '1.20.1', '0.2.0'), 'quilt-loader-0.2.0-1.20.1')
    assert.equal(loaderVersionId('forge', '1.20.1', '47.2.0'), 'forge-1.20.1-47.2.0')
    assert.equal(loaderVersionId('neoforge', '1.21.1', '21.1.9'), 'neoforge-21.1.9')
    assert.equal(loaderVersionId('vanilla', '1.20.1', 'x'), '1.20.1')
  })
  await test('required java majors match Mojang expectations', () => {
    assert.equal(requiredJavaMajor('1.8.9'), 8)
    assert.equal(requiredJavaMajor('1.16.5'), 8)
    assert.equal(requiredJavaMajor('1.17.1'), 16)
    assert.equal(requiredJavaMajor('1.18.2'), 17)
    assert.equal(requiredJavaMajor('1.20.4'), 17)
    assert.equal(requiredJavaMajor('1.20.5'), 21)
    assert.equal(requiredJavaMajor('1.21.1'), 21)
    assert.equal(requiredJavaMajor('1.7.10', 8), 8)
    assert.equal(requiredJavaMajor('1.20.1', 17), 17)
  })

  console.log('\nnetwork mirrors')
  await test('piston-data client jar rewrites to bmclapi with a version hint', () => {
    const urls = resolveUrls('https://piston-data.mojang.com/v1/objects/abcd/client.jar', { version: '1.20.1' })
    assert.ok(urls.some((u) => u.includes('bmclapi') && u.includes('/version/1.20.1/client')), urls.join('\n'))
  })
  await test('piston-meta package json rewrites to the version endpoint', () => {
    const urls = resolveUrls('https://piston-meta.mojang.com/v1/packages/' + 'a'.repeat(40) + '/1.20.1.json')
    assert.ok(urls.some((u) => u.includes('/version/1.20.1/json')), urls.join('\n'))
  })
  await test('mojang maven and fabric maven are mirrored', () => {
    assert.ok(resolveUrls('https://libraries.minecraft.net/org/ow2/asm/asm/9.5/asm-9.5.jar').some((u) => u.includes('bmclapi')))
    assert.ok(resolveUrls('https://maven.fabricmc.net/net/fabricmc/loader/0.15.0/loader-0.15.0.jar').some((u) => u.includes('bmclapi')))
  })
  await test('github traffic goes through a proxy prefix', () => {
    const urls = resolveUrls('https://github.com/owner/repo/releases/download/v1/file.zip')
    assert.ok(urls.some((u) => u.includes('gh-proxy.com')), urls.join('\n'))
  })
  await test('unknown hosts are left untouched', () => {
    const urls = resolveUrls('https://example.org/file.bin')
    assert.deepEqual(urls, ['https://example.org/file.bin'])
  })
  await test('custom mirror rules are applied', () => {
    const settings = loadSettings()
    saveSettings({ customMirrors: [{ match: 'https://example.org', replace: 'https://mirror.test' }] })
    const urls = resolveUrls('https://example.org/file.bin')
    assert.ok(urls.includes('https://mirror.test/file.bin'), urls.join('\n'))
    saveSettings({ customMirrors: settings.customMirrors })
  })

  console.log('\nperformance')
  await test('memory recommendation stays inside sane bounds', () => {
    assert.ok(recommendMemory(8192, 'mid') <= 8192)
    assert.equal(recommendMemory(4096, 'low'), 2048)
    assert.equal(recommendMemory(65536, 'ultra'), 8192)
  })
  await test('small heaps get the short flag list', () => {
    const small = tuneJvmArgs({} as never, 2048)
    assert.ok(small.includes('-XX:+UseG1GC'))
    assert.ok(!small.some((a) => a.startsWith('-XX:G1NewSizePercent')))
    const large = tuneJvmArgs({ cpu: { threads: 16 } } as never, 8192)
    assert.ok(large.some((a) => a.startsWith('-XX:ParallelGCThreads=')))
    assert.ok(large.includes('-XX:+AlwaysPreTouch'))
  })
  await test('perf pack is filtered by loader and version', () => {
    const fabric = perfModsFor('fabric', '1.21.1')
    assert.ok(fabric.some((m) => m.slug === 'sodium'))
    assert.ok(!fabric.some((m) => m.slug === 'embeddium'))
    const forge = perfModsFor('forge', '1.21.1')
    assert.ok(forge.some((m) => m.slug === 'embeddium'))
    assert.ok(!forge.some((m) => m.slug === 'sodium'))
    const old = perfModsFor('fabric', '1.19.2')
    assert.ok(old.some((m) => m.slug === 'starlight'))
    assert.ok(!perfModsFor('fabric', '1.21.1').some((m) => m.slug === 'starlight'))
  })
  await test('graphics presets merge into options.txt without losing other keys', async () => {
    const gameDir = path.join(tmpRoot, 'instances', 'demo')
    fs.mkdirSync(gameDir, { recursive: true })
    fs.writeFileSync(path.join(gameDir, 'options.txt'), 'fov:0.5\nkey_key.forward:87\ngamma:0.5\n')
    await applyGraphicsPreset(gameDir, 'max-fps')
    const options = await readOptions(gameDir)
    assert.equal(options['key_key.forward'], '87')
    assert.equal(options.renderDistance, '6')
    assert.equal(options.maxFps, '260')
    assert.equal(options.graphicsMode, '0')
    const preset = optionsForPreset('cinematic')
    assert.equal(preset.renderDistance, '24')
  })

  console.log('\naccounts and instances')
  await test('offline uuid is deterministic and version-3 shaped', () => {
    const uuid = offlineUuid('Notch')
    assert.equal(uuid, offlineUuid('Notch'))
    assert.notEqual(uuid, offlineUuid('notch'))
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  await test('username validation rejects bad names', () => {
    assert.equal(validateName('Steve'), null)
    assert.ok(validateName('ab'))
    assert.ok(validateName('this-name-is-way-too-long'))
    assert.ok(validateName('bad name'))
  })
  await test('instances derive a runnable version id and mods path', () => {
    const instance = defaultInstance({ name: 'Demo World', minecraftVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.0', id: 'demo' })
    assert.equal(instance.versionId, 'fabric-loader-0.15.0-1.20.1')
    assert.equal(instance.id, 'demo')
    assert.ok(instance.memoryMb >= 2048)
  })
  await test('mod registry survives an empty folder', async () => {
    const instance = defaultInstance({ name: 'Mods Test', minecraftVersion: '1.20.1', loader: 'fabric', id: 'mods-test' })
    const mods = await listInstalledMods(instance)
    assert.deepEqual(mods, [])
    assert.deepEqual(readRegistry(instance).mods, [])
    const modsDir = paths().instances + '/' + instance.id + '/mods'
    fs.mkdirSync(modsDir, { recursive: true })
    fs.writeFileSync(path.join(modsDir, 'sodium.jar'), 'not really a jar')
    fs.writeFileSync(path.join(modsDir, 'lithium.jar.disabled'), 'not really a jar')
    const listed = await listInstalledMods(instance)
    assert.equal(listed.length, 2)
    assert.equal(listed.find((m) => m.title === 'sodium')?.enabled, true)
    assert.equal(listed.find((m) => m.title === 'lithium')?.enabled, false)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  if (failed > 0) process.exitCode = 1
}

function nativeTag(): string {
  if (process.platform === 'win32') return 'natives-windows'
  if (process.platform === 'darwin') return 'natives-osx'
  return 'natives-linux'
}

void main()
