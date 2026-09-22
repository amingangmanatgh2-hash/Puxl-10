/**
 * End-to-end test of the IPC surface the renderer talks to.
 *
 * Electron cannot boot in a headless CI container, but the handlers can: this
 * registers them against a stub ipcMain and invokes them exactly like the UI
 * does, envelope and all. Catches wiring mistakes that type checking misses —
 * wrong argument order, missing awaits, handlers that throw on an empty folder.
 *
 *   npm run smoke:ipc
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { registerIpc } from '../src/main/ipc'
import { ensureDirs, setRootOverride, paths } from '../src/main/paths'
import { loadSettings, saveSettings } from '../src/main/store'
import { resolveUrls } from '../src/main/net'

type Handler = (event: unknown, ...args: unknown[]) => Promise<{ ok: boolean; data?: unknown; error?: string }>

const handlers = (globalThis as unknown as { __puxlIpcHandlers: Map<string, Handler> }).__puxlIpcHandlers

let passed = 0
let failed = 0

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed++
    console.log(`  \u001b[32m✓\u001b[0m ${name}`)
  } catch (err) {
    failed++
    console.log(`  \u001b[31m✗\u001b[0m ${name}`)
    console.log(`      ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel)
  assert.ok(handler, `channel ${channel} is not registered`)
  const result = await handler({}, ...args)
  assert.ok(result, `channel ${channel} returned nothing`)
  if (!result.ok) throw new Error(`${channel}: ${result.error}`)
  return result.data as T
}

async function expectError(channel: string, ...args: unknown[]): Promise<string> {
  const handler = handlers.get(channel)
  assert.ok(handler, `channel ${channel} is not registered`)
  const result = await handler({}, ...args)
  assert.equal(result.ok, false, `${channel} should have failed`)
  return result.error ?? ''
}

async function main(): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'puxl-ipc-'))
  setRootOverride(tmpRoot)
  ensureDirs()
  saveSettings({ rootDir: tmpRoot, geminiApiKey: '', proxyUrl: '', customMirrors: [], mirrorMode: 'auto' })

  registerIpc()
  console.log(`\nPuxl IPC tests — ${handlers.size} channels registered, root ${tmpRoot}\n`)

  console.log('renders the expected channels')
  await test('every channel the preload exposes exists', () => {
    const expected = [
      'settings:get',
      'settings:save',
      'settings:reset',
      'settings:defaults',
      'settings:pickRoot',
      'system:info',
      'system:openPath',
      'system:openExternal',
      'system:health',
      'system:versions',
      'system:diskUsage',
      'system:resolveUrl',
      'instances:list',
      'instances:get',
      'instances:create',
      'instances:update',
      'instances:delete',
      'instances:duplicate',
      'instances:installed',
      'instances:applyPreset',
      'instances:options',
      'instances:loaders',
      'instances:localVersion',
      'instances:openFolder',
      'install:start',
      'launch:prepare',
      'launch:start',
      'launch:kill',
      'launch:status',
      'mods:list',
      'mods:search',
      'mods:project',
      'mods:versions',
      'mods:install',
      'mods:uninstall',
      'mods:toggle',
      'mods:addFile',
      'mods:checkUpdates',
      'mods:update',
      'mods:perfList',
      'mods:installPerfPack',
      'mods:content:list',
      'mods:content:install',
      'mods:content:delete',
      'mods:installPack',
      'mods:installPackFromUrl',
      'accounts:list',
      'accounts:validateName',
      'accounts:addOffline',
      'accounts:remove',
      'accounts:setActive',
      'accounts:msBegin',
      'accounts:msPoll',
      'update:state',
      'update:check',
      'update:download',
      'update:install',
      'update:openRelease',
      'update:clearCache',
      'update:portable',
      'assistant:ask',
      'assistant:verify',
      'assistant:crash',
      'window:minimize',
      'window:toggleMaximize',
      'window:close',
      'window:state'
    ]
    const missing = expected.filter((channel) => !handlers.has(channel))
    assert.deepEqual(missing, [], `missing handlers: ${missing.join(', ')}`)
  })

  console.log('\nsettings')
  await test('settings round-trip and stay sanitised', async () => {
    const initial = await call<{ rootDir: string }>('settings:get')
    assert.equal(initial.rootDir, tmpRoot)
    const saved = await call<{ mirrorMode: string; downloadConcurrency: number }>('settings:save', { mirrorMode: 'iran', downloadConcurrency: 12 })
    assert.equal(saved.mirrorMode, 'iran')
    assert.equal(saved.downloadConcurrency, 12)
    // The network layer must immediately follow the saved settings.
    const routes = resolveUrls('https://piston-data.mojang.com/v1/objects/aa/client.jar', { version: '1.20.1' })
    assert.ok(routes[0].includes('bmclapi'), `expected a mirror first, got ${routes[0]}`)
    await call('settings:save', { mirrorMode: 'auto' })
  })

  console.log('\ninstances')
  await test('create, list, update, duplicate and delete', async () => {
    const created = await call<{ id: string; name: string; versionId: string }>('instances:create', {
      name: 'IPC Test',
      minecraftVersion: '1.20.1',
      loader: 'fabric',
      loaderVersion: '0.15.0'
    })
    assert.equal(created.versionId, 'fabric-loader-0.15.0-1.20.1')

    const list = await call<{ id: string }[]>('instances:list')
    assert.ok(list.some((i) => i.id === created.id))

    const updated = await call<{ memoryMb: number }>('instances:update', created.id, { memoryMb: 6144 })
    assert.equal(updated.memoryMb, 6144)

    const duplicate = await call<{ id: string }>('instances:duplicate', created.id, 'IPC Test Copy')
    assert.ok(duplicate.id)
    assert.ok(fs.existsSync(path.join(tmpRoot, 'instances', duplicate.id)))

    assert.equal(await call<boolean>('instances:delete', duplicate.id, true), true)
    const after = await call<{ id: string }[]>('instances:list')
    assert.ok(!after.some((i) => i.id === duplicate.id))
  })

  await test('an uninstalled instance reports a reason', async () => {
    const list = await call<{ id: string }[]>('instances:list')
    const status = await call<{ installed: boolean; reason?: string }>('instances:installed', list[0].id)
    assert.equal(status.installed, false)
    assert.ok(status.reason)
  })

  await test('unknown instance ids fail loudly instead of silently', async () => {
    const message = await expectError('instances:update', 'does-not-exist', { memoryMb: 2048 })
    assert.match(message, /not found/i)
  })

  await test('health checks cover storage and memory', async () => {
    const list = await call<{ id: string }[]>('instances:list')
    const health = await call<{ id: string; level: string }[]>('system:health', list[0].id)
    const ids = health.map((h) => h.id)
    assert.ok(ids.includes('storage'))
    assert.ok(ids.includes('memory'))
    assert.ok(health.every((h) => ['ok', 'warn', 'error'].includes(h.level)))
  })

  await test('graphics presets write through the IPC layer', async () => {
    const list = await call<{ id: string }[]>('instances:list')
    await call('instances:applyPreset', list[0].id, 'max-fps')
    const options = await call<Record<string, string>>('instances:options', list[0].id)
    assert.equal(options.renderDistance, '6')
  })

  console.log('\nmods')
  await test('an empty mods folder lists cleanly', async () => {
    const list = await call<{ id: string }[]>('instances:list')
    const mods = await call<unknown[]>('mods:list', list[0].id)
    assert.deepEqual(mods, [])
    assert.ok(fs.existsSync(path.join(paths().instances, list[0].id, 'mods')))
  })

  await test('local jars are picked up and toggled', async () => {
    const list = await call<{ id: string }[]>('instances:list')
    const modsDir = path.join(paths().instances, list[0].id, 'mods')
    fs.writeFileSync(path.join(modsDir, 'sodium.jar'), 'fake')
    const mods = await call<{ title: string; enabled: boolean }[]>('mods:list', list[0].id)
    assert.equal(mods.length, 1)
    assert.equal(mods[0].enabled, true)

    const disabled = await call<{ enabled: boolean }[]>('mods:toggle', list[0].id, 'sodium.jar', false)
    assert.equal(disabled[0].enabled, false)
    assert.ok(fs.existsSync(path.join(modsDir, 'sodium.jar.disabled')))

    const removed = await call<unknown[]>('mods:uninstall', list[0].id, 'sodium.jar')
    assert.deepEqual(removed, [])
  })

  await test('performance pack is filtered for the instance loader', async () => {
    const list = await call<{ id: string }[]>('instances:list')
    const mods = await call<{ slug: string }[]>('mods:perfList', list[0].id)
    assert.ok(mods.some((m) => m.slug === 'sodium'))
    assert.ok(!mods.some((m) => m.slug === 'embeddium'))
  })

  console.log('\naccounts')
  await test('offline accounts are validated, added and removed', async () => {
    assert.equal(await call<string | null>('accounts:validateName', 'Good_Name'), null)
    assert.ok(await call<string | null>('accounts:validateName', 'x'))
    await expectError('accounts:addOffline', 'no')

    const account = await call<{ id: string; uuid: string }>('accounts:addOffline', 'Good_Name')
    assert.match(account.uuid, /^[0-9a-f-]{36}$/)
    const store = await call<{ accounts: unknown[]; activeId: string }>('accounts:list')
    assert.equal(store.accounts.length, 1)
    assert.equal(store.activeId, account.id)

    await call('accounts:remove', account.id)
    const after = await call<{ accounts: unknown[] }>('accounts:list')
    assert.equal(after.accounts.length, 0)
  })

  await test('microsoft sign-in explains the missing application id', async () => {
    const message = await expectError('accounts:msBegin')
    assert.match(message, /azure|application id/i)
  })

  console.log('\nsystem')
  await test('hardware info is reported without a GPU probe crash', async () => {
    const info = await call<{ hardware: { tier: string; memoryMb: number; cpu: { threads: number } }; paths: Record<string, string> }>('system:info')
    assert.ok(info.hardware.memoryMb > 0)
    assert.ok(['low', 'mid', 'high', 'ultra'].includes(info.hardware.tier))
    assert.equal(info.paths.root, tmpRoot)
  })

  await test('disk usage reports every top-level folder', async () => {
    const usage = await call<Record<string, number>>('system:diskUsage')
    for (const key of ['versions', 'libraries', 'assets', 'instances', 'java', 'cache']) {
      assert.equal(typeof usage[key], 'number', `${key} missing from disk usage`)
    }
  })

  await test('launch status is queryable and kill is safe when idle', async () => {
    const status = await call<{ running: boolean }>('launch:status')
    assert.equal(status.running, false)
    assert.equal(await call<boolean>('launch:kill'), true)
  })

  await test('launching without an account fails with a clear message', async () => {
    const list = await call<{ id: string }[]>('instances:list')
    const message = await expectError('launch:start', list[0].id)
    assert.match(message, /account/i)
  })

  await test('assistant works offline without a key', async () => {
    const reply = await call<{ mode: string; text: string }>('assistant:ask', [{ role: 'user', text: 'mijn game crasht met out of memory' }], {})
    assert.equal(reply.mode, 'offline')
    assert.ok(reply.text.length > 20)
  })

  await test('crash explanation handles instances with no crash reports', async () => {
    const list = await call<{ id: string }[]>('instances:list')
    const text = await call<string>('assistant:crash', list[0].id)
    assert.match(text, /crash report|No crash reports/i)
  })

  await test('window channels respond in a headless process', async () => {
    assert.deepEqual(await call('window:state'), { maximized: false, fullscreen: false })
    assert.equal(await call('window:minimize'), true)
    assert.equal(await call('window:close'), true)
  })

  await test('update state is queryable without hitting the network', async () => {
    // Read the version from package.json so bumping the launcher never breaks this.
    const { version } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
    const state = await call<{ status: string; currentVersion: string }>('update:state')
    assert.equal(state.status, 'idle')
    assert.equal(state.currentVersion, version)
    assert.equal(await call<boolean>('update:portable'), false)
    assert.equal(await call<boolean>('update:clearCache'), true)
  })

  await test('installing an update that was never downloaded fails cleanly', async () => {
    const message = await expectError('update:install')
    assert.match(message, /not been downloaded/i)
  })

  await test('external links are restricted to http(s)', async () => {
    const message = await expectError('system:openExternal', 'file:///etc/passwd')
    assert.match(message, /http/i)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  if (failed > 0) process.exitCode = 1
}

void main()
