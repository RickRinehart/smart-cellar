import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,  // 5173 = Smart Kitchen dev port, 5174 = Smart Cellar
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
