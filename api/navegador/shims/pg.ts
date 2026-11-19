/**
 * Reemplazo de `pg` sobre PGlite (PostgreSQL compilado a WebAssembly).
 * Expone lo que usa el API (Pool, PoolClient, types) y reproduce las conversiones de db.ts:
 * DATE como texto AAAA-MM-DD, BIGINT como número y NUMERIC como texto, igual que `pg`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PGlite, types as tiposPglite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

interface Base {
  query(sql: string, params?: unknown[], opciones?: any): Promise<{ rows: any[]; affectedRows?: number; fields: any[] }>;
  exec(sql: string, opciones?: any): Promise<{ rows: any[]; affectedRows?: number; fields: any[] }[]>;
}

const PARSERS = {
  [tiposPglite.DATE]: (v: string) => v,
  [tiposPglite.INT8]: (v: string) => parseInt(v, 10),
  [tiposPglite.NUMERIC]: (v: string) => v,
};

let base: Base | null = null;
let creando: Promise<Base> | null = null;

/** La versión del navegador entrega aquí su conexión (PGliteWorker). */
export function establecerBase(b: Base): void {
  base = b;
}

/** Sin conexión entregada (pruebas en Node), se crea una base en memoria. */
async function obtenerBase(): Promise<Base> {
  if (base) return base;
  creando ??= PGlite.create({ extensions: { pg_trgm } }).then((pg) => (base = pg as unknown as Base));
  return creando;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  fields: any[];
}

async function consultar(sql: string, params?: unknown[]): Promise<QueryResult> {
  const db = await obtenerBase();
  // Varias sentencias sin parámetros (el esquema, el reinicio): se ejecutan con exec.
  if ((!params || params.length === 0) && /;\s*\S/.test(sql.trim().replace(/;\s*$/, ''))) {
    const resultados = await db.exec(sql, { parsers: PARSERS });
    const ultimo = resultados[resultados.length - 1] ?? { rows: [], fields: [] };
    return { rows: ultimo.rows, rowCount: ultimo.affectedRows ?? ultimo.rows.length, fields: ultimo.fields };
  }
  const r = await db.query(sql, (params ?? []).map(serializar), { parsers: PARSERS });
  return { rows: r.rows, rowCount: r.rows.length || (r.affectedRows ?? 0), fields: r.fields };
}

/** `pg` envía todo como texto; PGlite serializa por tipo. Se normaliza lo que puede diferir. */
function serializar(v: unknown): unknown {
  if (v === undefined) return null;
  return v;
}

/**
 * PGlite tiene una sola conexión. En PostgreSQL, lo que el API escribe con `pool` mientras hay una
 * transacción abierta (por ejemplo, la auditoría de un intento rechazado) va por otra conexión y
 * sobrevive al ROLLBACK. Aquí se ejecuta dentro de la transacción y, si esta se revierte, se repite.
 */
let transaccionAbierta = false;
let escriturasPorFuera: [string, unknown[] | undefined][] = [];

export class PoolClient {
  protected readonly esTransaccion: boolean = true;

  async query(sql: string | { text: string; values?: unknown[] }, params?: unknown[]): Promise<QueryResult> {
    const texto = typeof sql === 'object' ? sql.text : sql;
    const valores = typeof sql === 'object' ? sql.values : params;
    const orden = texto.trim().toUpperCase();
    if (this.esTransaccion) {
      if (orden === 'BEGIN') {
        transaccionAbierta = true;
        escriturasPorFuera = [];
      } else if (orden === 'COMMIT' || orden === 'ROLLBACK') {
        const resultado = await consultar(texto, valores);
        const repetir = orden === 'ROLLBACK' ? escriturasPorFuera : [];
        transaccionAbierta = false;
        escriturasPorFuera = [];
        for (const [s, v] of repetir) await consultar(s, v);
        return resultado;
      }
    } else if (transaccionAbierta && /^(INSERT|UPDATE|DELETE)\s/.test(orden)) {
      escriturasPorFuera.push([texto, valores]);
    }
    return consultar(texto, valores);
  }
  release(): void {}
}

export class Pool extends PoolClient {
  protected override readonly esTransaccion = false;
  // Contadores que lee la verificación de servicios del monitoreo.
  readonly totalCount = 1;
  readonly idleCount = 1;
  readonly waitingCount = 0;
  constructor(_opciones?: unknown) {
    super();
  }
  async connect(): Promise<PoolClient> {
    return new PoolClient();
  }
  async end(): Promise<void> {}
  on(): this {
    return this;
  }
}

export const types = { setTypeParser: (_oid: number, _fn: unknown) => undefined };

export default { Pool, PoolClient, types };
