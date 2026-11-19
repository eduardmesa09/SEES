/**
 * API del Piloto SSES dentro del navegador (versión de GitHub Pages).
 *
 * Es el mismo código de `src/` con cuatro reemplazos (ver `shims/`): el enrutador de Express,
 * `pg` sobre PGlite (PostgreSQL en WebAssembly), `jsonwebtoken` y `node:crypto`.
 * La interfaz le entrega cada petición con `atender` en lugar de enviarla por la red.
 */
import './proceso';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import ESQUEMA from '../sql/001_schema.sql';
import { pool } from '../src/db';
import { manejadorDeErrores, AppError } from '../src/errores';
import { medir } from '../src/modules/monitoreo/metricas';
import { rutas } from '../src/rutas';
import { sembrar } from '../src/seed';
import { hoy } from '../src/domain/reglas';
import { establecerBase } from './shims/pg';
import type { Enrutador } from './shims/express';

export interface Peticion {
  method: string;
  url: string; // con /api y la consulta
  headers: Record<string, string | null>;
  body: unknown;
}

export interface Respuesta {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const CANDADO = 'sses-api';
const CLAVE_SIEMBRA = 'sses-datos-cargados-el';
let listo: Promise<void> | null = null;

/** Abre la base (compartida entre pestañas) y, si está vacía, crea el esquema y los datos sintéticos. */
export function iniciar(): Promise<void> {
  listo ??= (async () => {
    const db = new PGliteWorker(new Worker(new URL('./pg/pglite-worker.js', import.meta.url), { type: 'module' }));
    await db.waitReady;
    establecerBase(db as never);
    await navigator.locks.request(CANDADO, async () => {
      const { rows } = await pool.query(`SELECT to_regclass('public.usuario') IS NOT NULL AS existe`);
      if (!rows[0].existe) await cargarDatos();
    });
  })();
  return listo;
}

async function cargarDatos(): Promise<void> {
  await pool.query(ESQUEMA);
  await sembrar(pool);
  try {
    localStorage.setItem(CLAVE_SIEMBRA, hoy());
  } catch {
    /* sin almacenamiento local: solo se pierde la fecha informativa */
  }
}

/** Deja los datos como recién instalados, igual que reiniciar-datos.cmd. */
export async function reiniciar(): Promise<void> {
  await iniciar();
  await navigator.locks.request(CANDADO, async () => {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await cargarDatos();
  });
}

/** Día en que se cargaron los datos sintéticos de este navegador. */
export function datosCargadosEl(): string | null {
  try {
    return localStorage.getItem(CLAVE_SIEMBRA);
  } catch {
    return null;
  }
}

/** Atiende una petición del API. Una a la vez, también entre pestañas, como lo haría una transacción por conexión. */
export async function atender(peticion: Peticion): Promise<Respuesta> {
  await iniciar();
  return navigator.locks.request(CANDADO, () => despachar(peticion));
}

function despachar(peticion: Peticion): Promise<Respuesta> {
  const url = new URL(peticion.url, 'http://sses.local');
  const headers = Object.fromEntries(
    Object.entries(peticion.headers).filter(([, v]) => v != null).map(([k, v]) => [k.toLowerCase(), v as string]),
  );
  const req = {
    method: peticion.method.toUpperCase(),
    path: url.pathname.replace(/^\/api(?=\/|$)/, '') || '/',
    originalUrl: url.pathname + url.search,
    query: Object.fromEntries(url.searchParams),
    headers,
    // Como si viajara por la red: el API recibe una copia, nunca el objeto de la interfaz.
    body: peticion.body == null ? {} : JSON.parse(JSON.stringify(peticion.body)),
    params: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };

  return new Promise<Respuesta>((resolver) => {
    const alTerminar: (() => void)[] = [];
    const res = {
      statusCode: 200,
      terminada: false,
      cabeceras: { 'content-type': 'application/json' } as Record<string, string>,
      status(codigo: number) {
        res.statusCode = codigo;
        return res;
      },
      setHeader(nombre: string, valor: string) {
        res.cabeceras[nombre.toLowerCase()] = valor;
        return res;
      },
      json(cuerpo: unknown) {
        terminar(cuerpo === undefined ? null : JSON.parse(JSON.stringify(cuerpo)));
      },
      send(cuerpo: unknown) {
        terminar(cuerpo);
      },
      on(evento: string, fn: () => void) {
        if (evento === 'finish') alTerminar.push(fn);
        return res;
      },
    };
    function terminar(cuerpo: unknown) {
      if (res.terminada) return;
      res.terminada = true;
      for (const fn of alTerminar) fn();
      resolver({ status: res.statusCode, headers: res.cabeceras, body: cuerpo });
    }
    const conError = (error?: unknown) => {
      const e = error ?? new AppError(404, 'RUTA_NO_ENCONTRADA', `No existe la operación ${req.method} ${req.originalUrl}.`);
      manejadorDeErrores(e, req as never, res as never, () => undefined);
    };
    medir(req as never, res as never, () => (rutas as unknown as Enrutador).manejar(req, res, conError));
  });
}
