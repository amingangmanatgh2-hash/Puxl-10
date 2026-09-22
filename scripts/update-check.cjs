/**
 * Live check against the real release endpoint using the launcher's own updater.
 * Handy when a user reports "update check failed": it prints the state the
 * launcher would show, including which route answered.
 *
 *   npm run check:update              # as this build's version
 *   npm run check:update -- 1.0.0     # pretend to be an older version
 *   PUXL_RELEASE_API=https://my-mirror/release.json npm run check:update
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')
const fakeVersion = process.argv[2]
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'puxl-updatecheck-'))

const appDir = path.join(scratch, 'app')
fs.mkdirSync(appDir, { recursive: true })
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (fakeVersion) pkg.version = fakeVersion
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkg))
process.env.PUXL_STUB_APPDATA = path.join(scratch, 'appdata')

const stubPath = path.join(__dirname, 'electron-stub.js')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function resolveFilename(request, ...rest) {
  if (request === 'electron') return stubPath
  return originalResolve.call(this, request, ...rest)
}

process.chdir(appDir)

const updater = require(require('./updater-bundle.cjs').buildUpdater(path.join(scratch, 'updater.cjs')))

updater
  .checkForUpdates()
  .then((state) => {
    console.log(JSON.stringify(state, null, 2))
    fs.rmSync(scratch, { recursive: true, force: true })
    process.exit(state.status === 'error' ? 1 : 0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
