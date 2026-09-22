/**
 * Guards the packaged app against the classic Electron packaging bug: the main
 * process requires undici and unzipper at runtime, so if they are missing from
 * app.asar the installed launcher dies on the first download.
 *
 * Reads the asar header directly — no asar CLI, no network, no encoding games.
 */
const fs = require('node:fs')
const path = require('node:path')

const REQUIRED = ['node_modules/undici', 'node_modules/unzipper']
const dist = path.join(__dirname, '..', 'dist')

if (!fs.existsSync(dist)) {
  console.error(`dist/ does not exist — run the packaging step first (${dist})`)
  process.exit(1)
}

const unpacked = fs.readdirSync(dist).find((entry) => {
  const full = path.join(dist, entry)
  return entry.includes('unpacked') && fs.statSync(full).isDirectory()
})

if (!unpacked) {
  console.error(`no *-unpacked directory inside ${dist}`)
  process.exit(1)
}

const asar = path.join(dist, unpacked, 'resources', 'app.asar')
if (!fs.existsSync(asar)) {
  console.error(`app.asar missing at ${asar}`)
  process.exit(1)
}

const contents = fs.readFileSync(asar)
const missing = REQUIRED.filter((dep) => !contents.includes(Buffer.from(dep, 'utf8')))

if (missing.length > 0) {
  console.error(`app.asar is missing runtime dependencies: ${missing.join(', ')}`)
  console.error('Add them explicitly to build.files in package.json.')
  process.exit(1)
}

console.log(`ok: ${missing.length === 0 ? 'all' : ''} runtime dependencies present in ${path.relative(process.cwd(), asar)} (${(contents.length / 1024 / 1024).toFixed(1)} MB)`)
