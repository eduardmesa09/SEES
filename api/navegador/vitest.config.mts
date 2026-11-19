import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Corre las mismas pruebas del API sobre PGlite, la base que usa la versión de GitHub Pages.
const shim = (archivo: string) => fileURLToPath(new URL(`./shims/${archivo}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias: { pg: shim('pg.ts') } },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./navegador/pruebas/preparar.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
