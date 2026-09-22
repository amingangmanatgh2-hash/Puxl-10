import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Only Electron stays external: undici and unzipper are bundled straight into
    // out/main/index.js so the packaged app needs no node_modules at all.
    plugins: [externalizeDepsPlugin({ exclude: ['undici', 'unzipper'] })],
    resolve: {
      alias: {
        // unzipper's optional S3 support is never used by Puxl.
        '@aws-sdk/client-s3': resolve(__dirname, 'src/main/stubs/aws-sdk-stub.ts')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
