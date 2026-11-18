import { crearApp } from './app';
import { config } from './config';
import { pool } from './db';
import { aplicarEsquema, esperarBaseDeDatos, existeEsquema } from './esquema';
import { hoy } from './domain/reglas';
import { sembrar } from './seed';

async function arrancar() {
  await esperarBaseDeDatos(pool);

  // Primer arranque: se crea el esquema y se cargan los datos sintéticos.
  if (!(await existeEsquema(pool))) {
    console.log('[sses] Base de datos vacía: creando esquema y datos sintéticos...');
    await aplicarEsquema(pool);
    const resumen = await sembrar(pool);
    console.log('[sses] Datos sintéticos cargados:', resumen);
  }

  crearApp().listen(config.puerto, () => {
    console.log(`[sses] API del Piloto SSES en http://localhost:${config.puerto}/api  (hoy: ${hoy()})`);
  });
}

arrancar().catch((error) => {
  console.error('[sses] No fue posible arrancar el API:', error);
  process.exit(1);
});
