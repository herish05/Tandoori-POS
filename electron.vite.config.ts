import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const root = resolve(__dirname)

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve(root, 'electron/shared'),
        '@main': resolve(root, 'electron/main')
      }
    },
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(root, 'electron/main/index.ts') }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve(root, 'electron/shared') }
    },
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(root, 'electron/preload/index.ts') }
    }
  },
  renderer: {
    root,
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
        '@shared': resolve(root, 'electron/shared')
      }
    },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'index.html') }
    }
  }
})
