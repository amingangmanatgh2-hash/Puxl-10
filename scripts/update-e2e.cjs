/**
 * End-to-end test of the update flow against a local HTTP server: release check,
 * version comparison, installer selection, resumable download and the resulting
 * 'ready' state. Hermetic — no internet, no GitHub, no Electron.
 *
 *   npm run smoke:update
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const Module = require('node:module')
const { buildUpdater } = require('./updater-bundle.cjs')

const root = path.join(__dirname, '..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'puxl-update-'))

// The launcher must think it is an old version so a release looks newer.
const appPkgDir = path.join(scratch, 'app')
fs.mkdirSync(appPkgDir, { recursive: true })
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const installedVersion = '1.0.0'
pkg.version = installedVersion
fs.writeFileSync(path.join(appPkgDir, 'package.json'), JSON.stringify(pkg))

process.env.PUXL_STUB_APPDATA = path.join(scratch, 'appdata')
const stubPath = path.join(__dirname, 'electron-stub.js')
const originalResolve = Module._resolveFilename
const originalCwd = process.cwd()
Module._resolveFilename = function resolveFilename(request, ...rest) {
  if (request === 'electron') return stubPath
  return originalResolve.call(this, request, ...rest)
}

const INSTALLER_BYTES = Buffer.alloc(96 * 1024, 7)

const server = http.createServer((req, res) => {
  if (req.url === '/release.json') {
    const payload = {
      tag_name: 'v9.9.9',
      html_url: 'https://example.invalid/releases/tag/v9.9.9',
      body: 'test release',
      published_at: new Date().toISOString(),
      assets: [
        { name: 'Puxl-Launcher-9.9.9-portable.exe', browser_download_url: `http://127.0.0.1:${port}/portable.exe`, size: 10 },
        { name: 'Puxl-Launcher-9.9.9-setup.exe', browser_download_url: `http://127.0.0.1:${port}/setup.exe`, size: INSTALLER_BYTES.length }
      ]
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
    return
  }
  if (req.url === '/setup.exe') {
    // Honour Range so the resumable downloader is exercised for real.
    const range = req.headers.range
    if (range) {
      const start = Number.parseInt(range.replace(/bytes=(\d+)-.*/, '$1'), 10) || 0
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-length': INSTALLER_BYTES.length - start,
        'content-range': `bytes ${start}-${INSTALLER_BYTES.length - 1}/${INSTALLER_BYTES.length}`
      })
      res.end(INSTALLER_BYTES.subarray(start))
      return
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': INSTALLER_BYTES.length })
    res.end(INSTALLER_BYTES)
    return
  }
  if (req.url === '/stale.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ tag_name: 'v0.0.1', assets: [] }))
    return
  }
  res.writeHead(404)
  res.end('not found')
})

let port = 0
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

async function main() {
  console.log(`\nUpdate flow test — local server, launcher reports ${installedVersion}\n`)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
  process.env.PUXL_RELEASE_API = `http://127.0.0.1:${port}/release.json`

  const bundle = buildUpdater(path.join(scratch, 'updater.cjs'))
  process.chdir(appPkgDir) // so the electron stub reports version 1.0.0
  const updater = require(bundle)

  try {
    const checking = updater.getUpdateState()
    report('starts idle at the installed version', checking.status === 'idle' ? null : new Error(JSON.stringify(checking)))

    const available = await updater.checkForUpdates()
    report('a newer release is detected', available.status === 'available' ? null : new Error(JSON.stringify(available)))
    report('the setup exe is chosen over the portable build', available.asset && available.asset.name.endsWith('-setup.exe') ? null : new Error(`picked ${available.asset && available.asset.name}`))
    report('the release metadata is parsed', available.release && available.release.version === '9.9.9' ? null : new Error('version mismatch'))

    let sawProgress = false
    const unsubscribe = updater.onUpdateState((state) => {
      if (state.status === 'downloading' && state.received > 0) sawProgress = true
    })
    const ready = await updater.downloadUpdate()
    unsubscribe()

    report('download reaches the ready state', ready.status === 'ready' ? null : new Error(JSON.stringify(ready)))
    report('progress was reported while downloading', sawProgress ? null : new Error('no progress events'))
    report('the installer was written and is byte-perfect', ready.status === 'ready' && fs.existsSync(ready.file) && fs.statSync(ready.file).size === INSTALLER_BYTES.length ? null : new Error('size mismatch'))

    // A cached, complete download must be reused rather than fetched again.
    const again = await updater.checkForUpdates()
    report('a second check still reports the release', again.status === 'available' ? null : new Error(JSON.stringify(again)))

    process.env.PUXL_RELEASE_API = `http://127.0.0.1:${port}/stale.json`
    const current = await updater.checkForUpdates()
    report('an older tag is reported as up to date', current.status === 'current' ? null : new Error(JSON.stringify(current)))

    process.env.PUXL_RELEASE_API = `http://127.0.0.1:${port}/missing.json`
    const failed = await updater.checkForUpdates()
    report('an unreachable endpoint reports an error instead of throwing', failed.status === 'error' && failed.message ? null : new Error(JSON.stringify(failed)))
  } catch (err) {
    report('update flow completed', err)
  }

  console.log(`\n${failures === 0 ? 'update flow ok' : `${failures} check(s) failed`}\n`)
  server.close()
  process.chdir(originalCwd)
  fs.rmSync(scratch, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
}

void main()
