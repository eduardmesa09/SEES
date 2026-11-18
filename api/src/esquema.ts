import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const RUTA_SQL = path.resolve(__dirname, '..', 'sql', '001_schema.sql');

export async function existeEsquema(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query(`SELECT to_regclass('public.usuario') IS NOT NULL AS existe`);
  return rows[0].existe as boolean;
}

export async function aplicarEsquema(pool: Pool): Promise<void> {
  await pool.query(readFileSync(RUTA_SQL, 'utf8'));
}

/** Borra todo y vuelve a crear el esquema vacío. Solo para ambientes con datos sintéticos. */
export async function recrearEsquema(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await aplicarEsquema(pool);
}

/** Espera a que la base de datos acepte conexiones (útil al arrancar junto con el contenedor). */
export async function esperarBaseDeDatos(pool: Pool, intentos = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (i >= intentos) throw error;
      await new Promise((resolver) => setTimeout(resolver, 1000));
    }
  }
}
