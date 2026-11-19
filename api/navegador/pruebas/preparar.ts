// Cada archivo de pruebas arranca con su propia base PGlite en memoria, con esquema y datos sintéticos.
import { readFileSync } from 'node:fs';
import { pool } from '../../src/db';
import { sembrar } from '../../src/seed';

await pool.query(readFileSync(new URL('../../sql/001_schema.sql', import.meta.url), 'utf8'));
await sembrar(pool);
