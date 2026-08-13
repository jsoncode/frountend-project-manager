import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Never watch Rust build output: cargo relinks app_lib.dll while the
      // previous instance may still hold it, and watching that file crashes
      // the dev server with EBUSY (killing `tauri dev`).
      ignored: ['**/src-tauri/target/**'],
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(root, 'index.html'),
        ai: path.resolve(root, 'ai.html'),
      },
    },
  },
})
