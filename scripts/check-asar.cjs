/**
 * Guards the packaged app against the classic Electron packaging bug: if the
 * downloader or the zip reader were left out of the bundle, the installed
 * launcher dies on the first download.
 *
 * Both libraries are bundled into out/main/index.js, so this asserts on markers
 * that only exist in their code. Reads the asar directly — no asar CLI, no
 * network, no encoding games.
 */
const fs = require('node:fs')
const path = require('node:path')

const REQUIRED = [
  // undici
  'UND_ERR_CONNECT_TIMEOUT',
  // unzipper
  'FILE_ENDED'
]
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
  console.error(`app.asar is missing bundled libraries: ${missing.join(', ')}`)
  console.error('Check electron.vite.config.ts — undici/unzipper must not be externalised.')
  process.exit(1)
}

console.log(`ok: all bundled libraries present in ${path.relative(process.cwd(), asar)} (${(contents.length / 1024 / 1024).toFixed(1)} MB)`)
