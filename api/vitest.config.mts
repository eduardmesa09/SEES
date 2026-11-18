import { defineConfig } from 'vitest/config';

// Las pruebas de integración usan una base de datos aparte (sses_test) para no tocar los datos de la demostración.
const BD_DE_PRUEBAS = process.env.TEST_DATABASE_URL ?? 'postgres://sses:sses_dev@localhost:5433/sses_test';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/preparar-bd.ts'],
    env: { DATABASE_URL: BD_DE_PRUEBAS },
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
