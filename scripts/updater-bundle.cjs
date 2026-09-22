/**
 * Builds the updater module standalone (with the Electron stub aliased in) so the
 * command-line tools can drive exactly the code the launcher runs.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')

function buildUpdater(outFile) {
  const out = outFile || path.join(root, '.smoke', 'updater.cjs')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(
    path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'),
    [
      'src/main/updater.ts',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--alias:electron=${path.join(__dirname, 'electron-stub.js')}`,
      '--external:@aws-sdk/client-s3',
      `--outfile=${out}`,
      '--log-level=warning'
    ],
    { cwd: root, stdio: 'inherit' }
  )
  return out
}

module.exports = { buildUpdater }
