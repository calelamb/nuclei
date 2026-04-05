import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isWeb = process.env.BUILD_TARGET === 'web';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // For web builds, output to dist-web; for Tauri, output to dist
  build: {
    outDir: isWeb ? 'dist-web' : 'dist',
  },
  define: {
    // Make build target available at runtime
    '__BUILD_TARGET__': JSON.stringify(isWeb ? 'web' : 'desktop'),
  },
})
