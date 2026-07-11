import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors vite.config.ts's build-time `define` block. vitest.config.ts is
  // a standalone config (not merged with vite.config.ts), so without this,
  // any code that reads `__APP_VERSION__` / `__BUILD_TARGET__` outside a
  // default-parameter position (which lazily skips evaluation when an
  // argument is supplied) throws `ReferenceError` under test — first hit by
  // PRD 09 Phase D's `useExperimentRun`, which stamps `__APP_VERSION__` into
  // every run manifest unconditionally.
  define: {
    __BUILD_TARGET__: JSON.stringify('desktop'),
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
