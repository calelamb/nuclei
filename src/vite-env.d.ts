/// <reference types="vite/client" />

// Compile-time constants injected via the `define` block in vite.config.ts.
declare const __BUILD_TARGET__: 'web' | 'desktop';
/** App version from package.json, inlined at build time. */
declare const __APP_VERSION__: string;
