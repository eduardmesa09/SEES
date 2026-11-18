import { Pool, PoolClient, types } from 'pg';
import { config } from './config';

// Las fechas (DATE) viajan como texto AAAA-MM-DD para no depender de zonas horarias.
types.setTypeParser(1082, (valor) => valor);
// count(*) y demás BIGINT se entregan como número.
types.setTypeParser(20, (valor) => parseInt(valor, 10));

export const pool = new Pool({ connectionString: config.databaseUrl });

/** Cualquier cosa capaz de ejecutar consultas: el pool o una transacción abierta. */
export type Ejecutor = Pick<Pool | PoolClient, 'query'>;

/** Ejecuta `fn` dentro de una única transacción: si falla, se revierte completa. */
export async function enTransaccion<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const resultado = await fn(tx);
    await tx.query('COMMIT');
    return resultado;
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}
