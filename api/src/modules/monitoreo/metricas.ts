import { RequestHandler } from 'express';

/**
 * Métricas de operación en memoria (CU-15, RQ_016, RQ_022).
 * Cada petición al API deja su duración, su resultado, quién la hizo y desde qué región.
 * En el Piloto esto lo recoge la plataforma de observabilidad; en el MVP basta con el proceso.
 */

export interface Muestra {
  t: number;
  ms: number;
  estado: number;
  metodo: string;
  ruta: string;
  usuarioId: number | null;
  correo: string | null;
  region: string | null;
}

const CAPACIDAD = 20_000;
const muestras: Muestra[] = [];

/** Umbral comprometido de tiempo de respuesta (percentil 95), en milisegundos. */
export const UMBRAL_P95_MS = 800;
/** Ventana en la que un usuario con actividad se considera conectado. */
export const VENTANA_CONECTADO_MS = 5 * 60_000;

export const medir: RequestHandler = (req, res, next) => {
  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    // La ruta se normaliza para agrupar los errores repetidos: /estrategias/12 -> /estrategias/:id
    const ruta = req.originalUrl.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');
    muestras.push({
      t: Date.now(),
      ms,
      estado: res.statusCode,
      metodo: req.method,
      ruta,
      usuarioId: req.usuario?.id ?? null,
      correo: req.usuario?.correo ?? null,
      region: req.usuario?.region ?? null,
    });
    if (muestras.length > CAPACIDAD) muestras.splice(0, muestras.length - CAPACIDAD);
  });
  next();
};

function percentil(valores: number[], p: number): number {
  if (!valores.length) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return Math.round(orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)] * 10) / 10;
}

export function muestrasDesde(desde: number, hasta = Date.now()): Muestra[] {
  return muestras.filter((m) => m.t >= desde && m.t <= hasta && !m.ruta.startsWith('/api/monitoreo'));
}

/** Concurrencia máxima: el mayor número de usuarios distintos activos en una ventana de cinco minutos. */
function concurrenciaMaxima(lista: Muestra[]): number {
  const conUsuario = lista.filter((m) => m.usuarioId != null);
  let maximo = 0;
  for (let i = 0, j = 0; j < conUsuario.length; j++) {
    while (conUsuario[j].t - conUsuario[i].t > VENTANA_CONECTADO_MS) i++;
    maximo = Math.max(maximo, new Set(conUsuario.slice(i, j + 1).map((m) => m.usuarioId)).size);
  }
  return maximo;
}

export function resumenDeOperacion(desde: number, hasta = Date.now()) {
  const lista = muestrasDesde(desde, hasta);
  const tiempos = lista.map((m) => m.ms);
  const errores = lista.filter((m) => m.estado >= 500 || m.estado === 0);
  const rechazos = lista.filter((m) => m.estado >= 400 && m.estado < 500);
  const agrupar = (l: Muestra[]) => {
    const grupos = new Map<string, { metodo: string; ruta: string; estado: number; veces: number; ultima: number }>();
    for (const m of l) {
      const clave = `${m.estado} ${m.metodo} ${m.ruta}`;
      const g = grupos.get(clave) ?? { metodo: m.metodo, ruta: m.ruta, estado: m.estado, veces: 0, ultima: 0 };
      g.veces++;
      g.ultima = Math.max(g.ultima, m.t);
      grupos.set(clave, g);
    }
    return [...grupos.values()].sort((a, b) => b.veces - a.veces).slice(0, 8);
  };
  return {
    peticiones: lista.length,
    p50: percentil(tiempos, 50),
    p95: percentil(tiempos, 95),
    maximoMs: tiempos.length ? Math.round(Math.max(...tiempos)) : 0,
    errores: errores.length,
    rechazos: rechazos.length,
    erroresRepetidos: agrupar([...errores, ...rechazos.filter((m) => m.estado !== 401)]),
    concurrenciaMaxima: concurrenciaMaxima(lista),
    usuarios: new Set(lista.filter((m) => m.usuarioId != null).map((m) => m.usuarioId)).size,
  };
}

/** Quién está conectado ahora y desde qué región. */
export function conectadosAhora() {
  const recientes = muestrasDesde(Date.now() - VENTANA_CONECTADO_MS).filter((m) => m.usuarioId != null);
  const porUsuario = new Map<number, { correo: string; region: string; ultima: number; peticiones: number }>();
  for (const m of recientes) {
    const u = porUsuario.get(m.usuarioId!) ?? { correo: m.correo ?? '', region: m.region ?? 'Sin región', ultima: 0, peticiones: 0 };
    u.ultima = Math.max(u.ultima, m.t);
    u.peticiones++;
    porUsuario.set(m.usuarioId!, u);
  }
  const usuarios = [...porUsuario.values()].sort((a, b) => b.ultima - a.ultima);
  const regiones = new Map<string, number>();
  for (const u of usuarios) regiones.set(u.region, (regiones.get(u.region) ?? 0) + 1);
  return {
    total: usuarios.length,
    usuarios: usuarios.map((u) => ({ ...u, ultima: new Date(u.ultima).toISOString() })),
    regiones: [...regiones.entries()].map(([region, conectados]) => ({ region, conectados })).sort((a, b) => b.conectados - a.conectados),
  };
}

/** Serie de los últimos minutos para la gráfica de la consola: peticiones y p95 por minuto. */
export function serieReciente(minutos = 30) {
  const ahora = Date.now();
  const inicio = ahora - minutos * 60_000;
  const lista = muestrasDesde(inicio);
  const serie = [];
  for (let i = 0; i < minutos; i++) {
    const desde = inicio + i * 60_000;
    const delMinuto = lista.filter((m) => m.t >= desde && m.t < desde + 60_000);
    serie.push({
      minuto: new Date(desde).toISOString(),
      peticiones: delMinuto.length,
      p95: percentil(delMinuto.map((m) => m.ms), 95),
      usuarios: new Set(delMinuto.filter((m) => m.usuarioId != null).map((m) => m.usuarioId)).size,
    });
  }
  return serie;
}
