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
        'src/components/qec/workbench/**/*.{ts,tsx}',
        'src/layout/qecPanelRegistry.ts',
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
