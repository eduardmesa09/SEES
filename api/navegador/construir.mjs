// Empaqueta el API para el navegador (versión de GitHub Pages).
//   node navegador/construir.mjs [carpeta de salida]   (por omisión: ../web/api-navegador)
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const salida = resolve(process.cwd(), process.argv[2] ?? resolve(aqui, '../../web/api-navegador'));
const shim = (archivo) => resolve(aqui, 'shims', archivo);
const pglite = resolve(aqui, '../node_modules/@electric-sql/pglite/dist');

rmSync(salida, { recursive: true, force: true });
mkdirSync(resolve(salida, 'pg'), { recursive: true });

const comun = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'warning' };

await build({
  ...comun,
  entryPoints: [resolve(aqui, 'entrada.ts')],
  outfile: resolve(salida, 'sses-api.js'),
  loader: { '.sql': 'text' },
  alias: {
    express: shim('express.ts'),
    pg: shim('pg.ts'),
    jsonwebtoken: shim('jsonwebtoken.ts'),
    'node:crypto': shim('crypto.ts'),
    crypto: shim('crypto.ts'),
  },
});

await build({
  ...comun,
  entryPoints: [resolve(aqui, 'pglite-worker.ts')],
  outfile: resolve(salida, 'pg', 'pglite-worker.js'),
});

// PGlite busca sus binarios junto al módulo que los pide.
copyFileSync(resolve(pglite, 'pglite.wasm'), resolve(salida, 'pg', 'pglite.wasm'));
copyFileSync(resolve(pglite, 'pglite.data'), resolve(salida, 'pg', 'pglite.data'));
copyFileSync(resolve(pglite, 'pg_trgm.tar.gz'), resolve(salida, 'pg_trgm.tar.gz'));
console.log(`[sses] API para el navegador en ${salida}`);
