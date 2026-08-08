import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Keep browser requests same-origin in dev while the API runs separately.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    css: true,
  },
})
