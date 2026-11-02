import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    // Proxy API agar dev berjalan same-origin (http://localhost:5173/api/...).
    // Ini membuat cookie sesi httpOnly menjadi first-party: tanpa proxy,
    // frontend di 127.0.0.1 dan API di localhost dianggap beda site oleh
    // browser sehingga cookie diblokir.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
})
