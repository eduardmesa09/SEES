import { Pool } from 'pg';
import { recrearEsquema } from '../src/esquema';
import { sembrar } from '../src/seed';

const BD_DE_PRUEBAS = process.env.TEST_DATABASE_URL ?? 'postgres://sses:sses_dev@localhost:5433/sses_test';

/** Crea (si hace falta) la base de datos de pruebas y la deja con el esquema y los datos sintéticos recién cargados. */
export default async function prepararBaseDeDatos() {
  const url = new URL(BD_DE_PRUEBAS);
  const nombre = url.pathname.slice(1);
  url.pathname = '/postgres';

  const administracion = new Pool({ connectionString: url.toString() });
  const existe = await administracion.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
  if (existe.rowCount === 0) await administracion.query(`CREATE DATABASE "${nombre}"`);
  await administracion.end();

  const pool = new Pool({ connectionString: BD_DE_PRUEBAS });
  await recrearEsquema(pool);
  await sembrar(pool);
  await pool.end();
}
