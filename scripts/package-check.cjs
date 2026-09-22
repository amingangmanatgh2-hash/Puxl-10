/**
 * Packaged-layout smoke test.
 *
 * Copies the built `out/` directory to a scratch folder with *no* node_modules
 * (exactly like the inside of app.asar), aliases `electron` to the stub, and
 * boots the real main bundle. If anything the launcher needs at runtime was left
 * out of the bundle, this fails here instead of on a user's machine.
 *
 *   npm run check:package     (requires `npm run build` first)
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'out')

if (!fs.existsSync(path.join(outDir, 'main', 'index.js'))) {
  console.error('out/main/index.js is missing — run `npm run build` first.')
  process.exit(1)
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'puxl-package-'))
const appDir = path.join(scratch, 'app')
fs.mkdirSync(appDir, { recursive: true })
fs.cpSync(outDir, path.join(appDir, 'out'), { recursive: true })
fs.copyFileSync(path.join(root, 'package.json'), path.join(appDir, 'package.json'))
fs.copyFileSync(path.join(__dirname, 'electron-stub.js'), path.join(appDir, 'electron-stub.cjs'))
fs.mkdirSync(path.join(appDir, 'resources'), { recursive: true })

// No node_modules anywhere in the scratch tree — that is the point of the test.
const hasNodeModules = fs.existsSync(path.join(appDir, 'node_modules'))
if (hasNodeModules) {
  console.error('scratch app unexpectedly contains node_modules')
  process.exit(1)
}

const originalResolve = Module._resolveFilename
Module._resolveFilename = function resolveFilename(request, ...rest) {
  if (request === 'electron') return path.join(appDir, 'electron-stub.cjs')
  return originalResolve.call(this, request, ...rest)
}

process.chdir(appDir)
const dataDir = path.join(scratch, 'data')
// The stub reads this instead of the real home directory, so the check cannot
// touch the machine it runs on.
process.env.PUXL_STUB_APPDATA = dataDir

let failures = 0
function report(name, err) {
  if (err) {
    failures++
    console.log(`  \u001b[31m✗\u001b[0m ${name}`)
    console.log(`      ${err instanceof Error ? err.message : String(err)}`)
  } else {
    console.log(`  \u001b[32m✓\u001b[0m ${name}`)
  }
}

function check(name, fn) {
  try {
    fn()
    report(name)
  } catch (err) {
    report(name, err)
  }
}

async function checkAsync(name, fn) {
  try {
    await fn()
    report(name)
  } catch (err) {
    report(name, err)
  }
}

console.log(`\nPackaged layout check — ${appDir}\n`)

const bundle = path.join(appDir, 'out', 'main', 'index.js')

check('main bundle loads without node_modules', () => {
  require(bundle)
})

check('download stack is inside the bundle (undici)', () => {
  const source = fs.readFileSync(bundle, 'utf8')
  const chunks = fs
    .readdirSync(path.join(appDir, 'out', 'main', 'chunks'))
    .map((file) => fs.readFileSync(path.join(appDir, 'out', 'main', 'chunks', file), 'utf8'))
    .join('')
  const all = source + chunks
  for (const marker of ['UND_ERR_CONNECT_TIMEOUT', 'FILE_ENDED']) {
    if (!all.includes(marker)) throw new Error(`missing marker ${marker}`)
  }
})

check('no bare require of node_modules is left in the bundle', () => {
  const source = fs.readFileSync(bundle, 'utf8')
  const suspicious = ['require("undici")', "require('undici')", 'require("unzipper")', "require('unzipper')"]
  const found = suspicious.filter((needle) => source.includes(needle))
  if (found.length > 0) throw new Error(`external requires still present: ${found.join(', ')}`)
})

// app.whenReady() resolves on a microtask, so the startup checks come after a tick.
setTimeout(async () => {
  await checkAsync('startup registered the renderer channels', () => {
    const handlers = globalThis.__puxlIpcHandlers
    if (!handlers || handlers.size < 60) {
      throw new Error(`expected 60+ ipc channels, got ${handlers ? handlers.size : 0}`)
    }
  })

  await checkAsync('instance store boots cleanly through the packaged handlers', async () => {
    const result = await globalThis.__puxlIpcHandlers.get('instances:list')({})
    if (!result.ok) throw new Error(result.error)
    if (!Array.isArray(result.data)) throw new Error('instances:list did not return an array')
  })

  await checkAsync('settings round-trip writes only inside the app data folder', async () => {
    const save = globalThis.__puxlIpcHandlers.get('settings:save')
    const result = await save({}, { rootDir: dataDir, downloadConcurrency: 4 })
    if (!result.ok) throw new Error(result.error)
    const file = path.join(dataDir, 'settings.json')
    if (!fs.existsSync(file)) throw new Error(`settings.json was not written to ${file}`)
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (saved.downloadConcurrency !== 4) throw new Error('settings did not persist the new value')
    if (!fs.existsSync(path.join(dataDir, 'instances'))) throw new Error('game folders were not created')
  })

  await checkAsync('the update check reports a usable state offline', async () => {
    const result = await globalThis.__puxlIpcHandlers.get('update:state')({})
    if (!result.ok) throw new Error(result.error)
    if (result.data.currentVersion !== packageVersion()) {
      throw new Error(`unexpected version ${result.data.currentVersion}`)
    }
  })

  console.log(`\n${failures === 0 ? 'packaged layout ok' : `${failures} check(s) failed`}\n`)
  fs.rmSync(scratch, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
}, 1200)

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version
}
