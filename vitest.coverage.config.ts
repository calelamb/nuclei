import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      include: [
        // main.tsx's P1 change is a CSS import only; it has no executable
        // workbench behavior, so the integration denominator starts at the
        // rendered layout and platform boundaries below.
        'src/components/layout/ActivityBar.tsx',
        'src/components/layout/PanelLayout.tsx',
        'src/components/layout/Sidebar.tsx',
        'src/components/qec/workbench/**/*.{ts,tsx}',
        'src/layout/panelRegistry.ts',
        'src/layout/qecPanelRegistry.ts',
        'src/platform/PlatformProvider.tsx',
        'src/platform/e2eFixtureBridge.ts',
        'src/services/qecStudyFs.ts',
        'src/services/qecStudyStore.ts',
        'src/services/qecWorkbenchPersistence*.ts',
        'src/stores/qecStudyUiStore.ts',
        'src/stores/qecWorkbenchStore.ts',
        'src/stores/researchSelectionStore.ts',
        'src/styles/qecTokens.ts',
        'src/types/qecSelection.ts',
        'src/types/qecStudy.ts',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        lines: 80,
      },
    },
  },
}));
