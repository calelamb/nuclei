import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isWeb = process.env.BUILD_TARGET === 'web';
// Web IDE is deployed at getnuclei.dev/try alongside the landing page,
// so all asset URLs need the /try/ prefix. Override with VITE_BASE_PATH
// if deploying to a different path.
const basePath = process.env.VITE_BASE_PATH ?? (isWeb ? '/try/' : '/');

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: basePath,
  // For web builds, output to dist-web; for Tauri, output to dist
  build: {
    outDir: isWeb ? 'dist-web' : 'dist',
  },
  define: {
    // Make build target available at runtime
    '__BUILD_TARGET__': JSON.stringify(isWeb ? 'web' : 'desktop'),
  },
})
