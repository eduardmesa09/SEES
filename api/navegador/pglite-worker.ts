// Worker de la base de datos. PGliteWorker elige una sola pestaña "líder" que abre la base
// guardada en IndexedDB; las demás pestañas le envían sus consultas. Así todas ven los mismos datos.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { worker } from '@electric-sql/pglite/worker';

worker({
  async init() {
    const pg = await PGlite.create('idb://sses-piloto', { extensions: { pg_trgm }, relaxedDurability: true });
    await pg.exec(`SET TIME ZONE 'America/Bogota'`);
    return pg;
  },
});
