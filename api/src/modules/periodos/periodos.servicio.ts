import { Ejecutor } from '../../db';
import { AppError } from '../../errores';
import { hoy } from '../../domain/reglas';
import { SemanaIso, nombreDelMes, rangoDelMes, semanasDelMes } from '../../domain/semanas';

interface Vigencia {
  fechaInicio: string;
  fechaFin: string;
}

export interface Mes {
  anio: number;
  mes: number;
}

function mesDe(fecha: string): Mes {
  const [anio, mes] = fecha.split('-').map(Number);
  return { anio, mes };
}

function indice(m: Mes): number {
  return m.anio * 12 + (m.mes - 1);
}

/** Periodos mensuales de una estrategia: desde su mes de inicio hasta su mes final, sin pasar del mes en curso. */
export function mesesDeEstrategia(estrategia: Vigencia, fechaHoy = hoy()): Mes[] {
  const desde = indice(mesDe(estrategia.fechaInicio));
  const hasta = Math.min(indice(mesDe(estrategia.fechaFin)), indice(mesDe(fechaHoy)));
  const meses: Mes[] = [];
  for (let i = desde; i <= hasta; i++) {
    meses.push({ anio: Math.floor(i / 12), mes: (i % 12) + 1 });
  }
  return meses;
}

/** Rechaza periodos futuros o que no hacen parte de la vigencia de la estrategia. */
export function validarPeriodo(estrategia: Vigencia, anio: number, mes: number, fechaHoy = hoy()): void {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new AppError(400, 'PERIODO_INVALIDO', 'El periodo mensual indicado no es válido.');
  }
  const solicitado = indice({ anio, mes });
  if (solicitado > indice(mesDe(fechaHoy))) {
    throw new AppError(400, 'PERIODO_FUTURO', 'No puede registrarse información sobre un periodo que aún no ha iniciado.');
  }
  if (solicitado < indice(mesDe(estrategia.fechaInicio)) || solicitado > indice(mesDe(estrategia.fechaFin))) {
    throw new AppError(
      400,
      'PERIODO_FUERA_DE_VIGENCIA',
      `El periodo ${nombreDelMes(anio, mes)} está por fuera de la vigencia de la estrategia (${estrategia.fechaInicio} a ${estrategia.fechaFin}).`,
    );
  }
}

/** Semanas del mes que se esperan para la estrategia: las que se cruzan con su vigencia. */
export function semanasEsperadas(estrategia: Vigencia, anio: number, mes: number): SemanaIso[] {
  return semanasDelMes(anio, mes).filter((s) => s.fin >= estrategia.fechaInicio && s.inicio <= estrategia.fechaFin);
}

/**
 * Semanas esperadas que ya terminaron: son las que el tutor ya debía haber reportado.
 * La semana en curso puede reportarse, pero todavía no es exigible.
 */
export function semanasExigibles(estrategia: Vigencia, anio: number, mes: number, fechaHoy = hoy()): SemanaIso[] {
  return semanasEsperadas(estrategia, anio, mes).filter((s) => s.fin < fechaHoy);
}

/** Rango de fechas en el que puede registrarse un acompañamiento dentro del periodo. */
export function rangoValidoDeAcompanamiento(estrategia: Vigencia, anio: number, mes: number, fechaHoy = hoy()) {
  const rango = rangoDelMes(anio, mes);
  const desde = rango.inicio > estrategia.fechaInicio ? rango.inicio : estrategia.fechaInicio;
  const hasta = [rango.fin, estrategia.fechaFin, fechaHoy].sort()[0];
  return { desde, hasta };
}

export interface EstadoPeriodo {
  id: number | null;
  estado: 'ABIERTO' | 'CERRADO';
  cerradoEn: Date | null;
  cerradoPor: string | null;
  justificacionCierre: string | null;
  extemporaneo: boolean;
  corregido: boolean;
  version: number;
  reaperturaPendiente: boolean;
}

const SELECT_PERIODO = `
  SELECT p.id, p.anio, p.mes, p.estado, p.cerrado_en AS "cerradoEn", u.nombre AS "cerradoPor",
         p.justificacion_cierre AS "justificacionCierre", p.extemporaneo, p.corregido, p.version,
         EXISTS (SELECT 1 FROM solicitud_reapertura r WHERE r.periodo_id = p.id AND r.estado = 'RADICADA') AS "reaperturaPendiente"
    FROM periodo_mensual p LEFT JOIN usuario u ON u.id = p.cerrado_por`;

const ABIERTO: EstadoPeriodo = {
  id: null, estado: 'ABIERTO', cerradoEn: null, cerradoPor: null, justificacionCierre: null,
  extemporaneo: false, corregido: false, version: 1, reaperturaPendiente: false,
};

/** Estado de un periodo mensual; si nunca se ha registrado nada en él, está abierto. */
export async function estadoDelPeriodo(db: Ejecutor, estrategiaId: number, anio: number, mes: number): Promise<EstadoPeriodo> {
  const { rows } = await db.query(`${SELECT_PERIODO} WHERE p.estrategia_id = $1 AND p.anio = $2 AND p.mes = $3`, [
    estrategiaId, anio, mes,
  ]);
  return rows[0] ?? { ...ABIERTO };
}

/** Estados de todos los periodos registrados de varias estrategias, indexados por "estrategia-anio-mes". */
export async function estadosDePeriodos(db: Ejecutor, estrategiaIds: number[]): Promise<Map<string, EstadoPeriodo>> {
  const { rows } = await db.query(`${SELECT_PERIODO.replace('SELECT p.id,', 'SELECT p.estrategia_id AS "estrategiaId", p.id,')} WHERE p.estrategia_id = ANY($1::int[])`, [
    estrategiaIds,
  ]);
  return new Map(rows.map((r) => [`${r.estrategiaId}-${r.anio}-${r.mes}`, r as EstadoPeriodo]));
}

export function estadoDe(mapa: Map<string, EstadoPeriodo>, estrategiaId: number, anio: number, mes: number): EstadoPeriodo {
  return mapa.get(`${estrategiaId}-${anio}-${mes}`) ?? { ...ABIERTO };
}

/** Obtiene el periodo mensual de la estrategia; lo crea abierto si aún no existe. Si está cerrado, rechaza. */
export async function obtenerPeriodoAbierto(tx: Ejecutor, estrategiaId: number, anio: number, mes: number) {
  const { rows } = await tx.query(
    `INSERT INTO periodo_mensual (estrategia_id, anio, mes) VALUES ($1, $2, $3)
     ON CONFLICT (estrategia_id, anio, mes) DO UPDATE SET anio = EXCLUDED.anio
     RETURNING id, estado`,
    [estrategiaId, anio, mes],
  );
  const periodo = rows[0] as { id: number; estado: 'ABIERTO' | 'CERRADO' };
  if (periodo.estado === 'CERRADO') {
    const estado = await estadoDelPeriodo(tx, estrategiaId, anio, mes);
    throw new AppError(
      409,
      'PERIODO_CERRADO',
      `El periodo ${nombreDelMes(anio, mes)} fue cerrado${estado.cerradoPor ? ` por ${estado.cerradoPor}` : ''}: ya no admite registros ni ediciones. Si necesita corregirlo, solicite su reapertura al tutor líder.`,
      { cerradoPor: estado.cerradoPor, cerradoEn: estado.cerradoEn, reaperturaPendiente: estado.reaperturaPendiente },
    );
  }
  return periodo;
}
