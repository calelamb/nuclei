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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor') || id.includes('@monaco-editor/react')) {
            return 'monaco';
          }
          if (id.includes('/src/components/challenges/') || id.includes('/src/data/challenges/') || id.includes('/src/stores/challengeModeStore')) {
            return 'challenge-mode';
          }
          if (id.includes('/src/components/learning/') || id.includes('/src/data/lessons/') || id.includes('/src/stores/learnStore')) {
            return 'learn-mode';
          }
          if (id.includes('/src/components/community/') || id.includes('/src/services/communityService') || id.includes('/src/stores/communityStore')) {
            return 'community';
          }
          if (id.includes('/src/components/hardware/') || id.includes('/src/stores/hardwareStore')) {
            return 'hardware';
          }
          if (id.includes('/src/components/plugins/') || id.includes('/src/plugins/')) {
            return 'plugins';
          }
          return undefined;
        },
      },
    },
  },
  define: {
    // Make build target available at runtime
    '__BUILD_TARGET__': JSON.stringify(isWeb ? 'web' : 'desktop'),
  },
})
