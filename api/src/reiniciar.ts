/**
 * Deja la base de datos como recién instalada: borra todo, recrea el esquema y vuelve a
 * cargar los datos sintéticos. Sirve para ensayar la demostración las veces que haga falta.
 *
 *   npm run db:reset
 */
import { pool } from './db';
import { esperarBaseDeDatos, recrearEsquema } from './esquema';
import { sembrar } from './seed';

async function reiniciar() {
  await esperarBaseDeDatos(pool);
  await recrearEsquema(pool);
  const resumen = await sembrar(pool);
  console.log('[sses] Base de datos reiniciada con datos sintéticos:', resumen);
  await pool.end();
}

reiniciar().catch((error) => {
  console.error('[sses] Falló el reinicio:', error);
  process.exit(1);
});
