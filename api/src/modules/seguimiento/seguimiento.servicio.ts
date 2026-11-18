import { z } from 'zod';
import { Contexto } from '../../contexto';
import { Ejecutor, enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { calcularCobertura } from '../../domain/cobertura';
import { evaluarSeguimiento } from '../../domain/oportunidad';
import { CAUSAS_INACTIVIDAD, fechaLocal, hoy } from '../../domain/reglas';
import { SemanaIso, nombreDelMes, semanasDelMes } from '../../domain/semanas';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';
import { EstrategiaBase, exigirEstrategia } from '../estrategias/estrategias.servicio';
import { estadoDelPeriodo, obtenerPeriodoAbierto, semanasEsperadas, validarPeriodo } from '../periodos/periodos.servicio';

export const esquemaSeguimiento = z.object({
  anio: z.number().int(),
  mes: z.number().int().min(1).max(12),
  sinActividad: z.boolean().default(false),
  causaInactividad: z.string().trim().max(200).optional(),
  actividades: z.string().trim().max(2000).optional(),
  avanceCompromisos: z.string().trim().max(2000).optional(),
  dificultades: z.string().trim().max(2000).optional(),
  acciones: z.string().trim().max(2000).optional(),
});
export type DatosSeguimiento = z.infer<typeof esquemaSeguimiento>;

/**
 * REPORTADA / SIN_ACTIVIDAD: la semana tiene seguimiento. PENDIENTE: ya terminó y no se reportó.
 * EN_CURSO: está transcurriendo y aún puede reportarse a tiempo. FUTURA: todavía no ha ocurrido.
 */
export type EstadoSemana = 'REPORTADA' | 'SIN_ACTIVIDAD' | 'PENDIENTE' | 'EN_CURSO' | 'FUTURA';

interface FilaSeguimiento {
  id: number;
  anioIso: number;
  semanaIso: number;
  inicioSemana: string;
  finSemana: string;
  sinActividad: boolean;
  causaInactividad: string | null;
  actividades: string | null;
  avanceCompromisos: string | null;
  dificultades: string | null;
  acciones: string | null;
  registradoPor: string;
  registradoEn: Date;
  actualizadoEn: Date | null;
  version: number;
}

const SELECT_SEGUIMIENTO = `
  SELECT s.id, s.anio_iso AS "anioIso", s.semana_iso AS "semanaIso",
         s.inicio_semana AS "inicioSemana", s.fin_semana AS "finSemana",
         s.sin_actividad AS "sinActividad", s.causa_inactividad AS "causaInactividad",
         s.actividades, s.avance_compromisos AS "avanceCompromisos", s.dificultades, s.acciones,
         u.nombre AS "registradoPor", s.registrado_en AS "registradoEn",
         s.actualizado_en AS "actualizadoEn", s.version
    FROM seguimiento_semanal s
    JOIN usuario u ON u.id = s.registrado_por`;

/**
 * Estado de cada semana del periodo y cobertura del mes (RQ_009).
 * Una semana reportada sin actividad es distinta de una semana en blanco.
 */
export async function estadoSemanal(db: Ejecutor, estrategia: EstrategiaBase, anio: number, mes: number) {
  const esperadas = semanasEsperadas(estrategia, anio, mes);
  const { rows } = await db.query(
    `${SELECT_SEGUIMIENTO} WHERE s.estrategia_id = $1 AND s.inicio_semana = ANY($2::date[]) ORDER BY s.inicio_semana`,
    [estrategia.id, esperadas.map((s) => s.inicio)],
  );
  const seguimientos = rows as FilaSeguimiento[];
  const fechaHoy = hoy();

  const semanas = esperadas.map((semana) => {
    const fila = seguimientos.find((s) => s.inicioSemana === semana.inicio) ?? null;
    let estado: EstadoSemana;
    if (fila) estado = fila.sinActividad ? 'SIN_ACTIVIDAD' : 'REPORTADA';
    else if (semana.inicio > fechaHoy) estado = 'FUTURA';
    else estado = semana.fin < fechaHoy ? 'PENDIENTE' : 'EN_CURSO';
    const seguimiento = fila
      ? { ...fila, fechaRegistro: fechaLocal(fila.registradoEn), ...evaluarSeguimiento(semana.fin, fechaLocal(fila.registradoEn)) }
      : null;
    return { ...semana, estado, seguimiento };
  });

  const reportadas = semanas.filter((s) => s.seguimiento).length;
  // Exigibles: las semanas que ya terminaron, más la que esté en curso si ya fue reportada.
  const exigibles = semanas.filter((s) => s.seguimiento || s.estado === 'PENDIENTE').length;
  return {
    semanas,
    cobertura: calcularCobertura(reportadas, semanas.length),
    exigibles,
    pendientes: semanas.filter((s) => s.estado === 'PENDIENTE').length,
  };
}

/** CU-09: semanas que componen el periodo, indicando cuáles están reportadas y cuáles pendientes. */
export async function semanasDelPeriodo(ctx: Contexto, estrategiaId: number, anio: number, mes: number) {
  const estrategia = await exigirEstrategia(pool, ctx, estrategiaId);
  validarPeriodo(estrategia, anio, mes);
  const [estado, periodo] = await Promise.all([
    estadoSemanal(pool, estrategia, anio, mes),
    estadoDelPeriodo(pool, estrategiaId, anio, mes),
  ]);
  return {
    estrategia: { id: estrategia.id, codigo: estrategia.codigo, nombre: estrategia.nombre, entidadNombre: estrategia.entidadNombre },
    periodo: { anio, mes, nombre: nombreDelMes(anio, mes), ...periodo },
    ...estado,
  };
}

function describir(semana: SemanaIso): string {
  return `semana ${semana.semanaIso} (${semana.inicio} a ${semana.fin})`;
}

/** CU-09 / RQ_009: registro del seguimiento semanal y recálculo de la cobertura del mes. */
export async function registrarSeguimiento(
  ctx: Contexto,
  estrategiaId: number,
  anioIso: number,
  semanaIso: number,
  datos: DatosSeguimiento,
) {
  return enTransaccion(async (tx) => {
    // Si el tutor no tiene asignada la estrategia, aquí se rechaza y se audita el intento (RN-04).
    const estrategia = await exigirEstrategia(tx, ctx, estrategiaId, { bloquear: true });
    validarPeriodo(estrategia, datos.anio, datos.mes);

    const delMes = semanasDelMes(datos.anio, datos.mes);
    const semana = delMes.find((s) => s.anioIso === anioIso && s.semanaIso === semanaIso);
    if (!semana) {
      throw new AppError(
        400,
        'SEMANA_FUERA_DE_PERIODO',
        `La semana ${semanaIso} no pertenece a ${nombreDelMes(datos.anio, datos.mes)}. Las semanas válidas de ese mes son: ${delMes.map((s) => s.semanaIso).join(', ')}.`,
        { semanasValidas: delMes },
      );
    }
    if (semana.fin < estrategia.fechaInicio || semana.inicio > estrategia.fechaFin) {
      throw new AppError(
        400,
        'SEMANA_FUERA_DE_VIGENCIA',
        `La ${describir(semana)} está por fuera de la vigencia de la estrategia.`,
      );
    }
    if (semana.inicio > hoy()) {
      throw new AppError(
        400,
        'SEMANA_FUTURA',
        `La ${describir(semana)} aún no ha ocurrido: no puede reportarse lo que todavía no ha pasado.`,
      );
    }

    if (datos.sinActividad) {
      if (!datos.causaInactividad || !(CAUSAS_INACTIVIDAD as readonly string[]).includes(datos.causaInactividad)) {
        throw new AppError(400, 'CAUSA_REQUERIDA', 'Seleccione la causa por la cual no hubo actividad en la semana.', {
          campos: { causaInactividad: 'Seleccione una causa de la lista' },
        });
      }
    } else if (!datos.actividades || datos.actividades.length < 5) {
      throw new AppError(400, 'VALIDACION', 'Describa las actividades realizadas durante la semana.', {
        campos: { actividades: 'Campo obligatorio' },
      });
    }

    const periodo = await obtenerPeriodoAbierto(tx, estrategiaId, datos.anio, datos.mes);
    const valores = {
      sinActividad: datos.sinActividad,
      causaInactividad: datos.sinActividad ? datos.causaInactividad! : null,
      actividades: datos.sinActividad ? null : datos.actividades!,
      avanceCompromisos: datos.sinActividad ? null : datos.avanceCompromisos || null,
      dificultades: datos.sinActividad ? null : datos.dificultades || null,
      acciones: datos.sinActividad ? null : datos.acciones || null,
    };

    const previo = await tx.query(
      `${SELECT_SEGUIMIENTO} WHERE s.estrategia_id = $1 AND s.anio_iso = $2 AND s.semana_iso = $3`,
      [estrategiaId, anioIso, semanaIso],
    );
    const existente = previo.rows[0] as FilaSeguimiento | undefined;

    let id: number;
    if (existente) {
      // Ya hay seguimiento para la semana: no se crea otro, se edita el existente y se conserva la versión anterior.
      id = existente.id;
      await tx.query(
        `UPDATE seguimiento_semanal
            SET sin_actividad = $2, causa_inactividad = $3, actividades = $4, avance_compromisos = $5,
                dificultades = $6, acciones = $7, actualizado_en = now(), version = version + 1
          WHERE id = $1`,
        [id, valores.sinActividad, valores.causaInactividad, valores.actividades, valores.avanceCompromisos, valores.dificultades, valores.acciones],
      );
      await registrarAuditoria(tx, ctx, {
        operacion: 'MODIFICAR_SEGUIMIENTO_SEMANAL',
        entidadAfectada: 'SEGUIMIENTO_SEMANAL',
        registroId: id,
        valoresPrevios: {
          sinActividad: existente.sinActividad,
          causaInactividad: existente.causaInactividad,
          actividades: existente.actividades,
          avanceCompromisos: existente.avanceCompromisos,
          dificultades: existente.dificultades,
          acciones: existente.acciones,
        },
        valoresNuevos: valores,
        detalle: `Seguimiento de la ${describir(semana)} de ${estrategia.codigo} modificado`,
      });
    } else {
      const insercion = await tx.query(
        `INSERT INTO seguimiento_semanal
           (periodo_id, estrategia_id, anio_iso, semana_iso, inicio_semana, fin_semana, sin_actividad,
            causa_inactividad, actividades, avance_compromisos, dificultades, acciones, registrado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          periodo.id, estrategiaId, anioIso, semanaIso, semana.inicio, semana.fin, valores.sinActividad,
          valores.causaInactividad, valores.actividades, valores.avanceCompromisos, valores.dificultades,
          valores.acciones, ctx.usuario.id,
        ],
      );
      id = insercion.rows[0].id as number;
      await registrarAuditoria(tx, ctx, {
        operacion: 'REGISTRAR_SEGUIMIENTO_SEMANAL',
        entidadAfectada: 'SEGUIMIENTO_SEMANAL',
        registroId: id,
        valoresNuevos: { estrategia: estrategia.codigo, semana: semana.semanaIso, inicio: semana.inicio, fin: semana.fin, ...valores },
        detalle: valores.sinActividad
          ? `${estrategia.codigo}: ${describir(semana)} reportada sin actividad (${valores.causaInactividad})`
          : `${estrategia.codigo}: seguimiento de la ${describir(semana)} registrado`,
      });
    }

    // La cobertura del mes se recalcula en cada operación.
    const estado = await estadoSemanal(tx, estrategia, datos.anio, datos.mes);
    return {
      creado: !existente,
      semana: estado.semanas.find((s) => s.inicio === semana.inicio),
      cobertura: estado.cobertura,
      exigibles: estado.exigibles,
      pendientes: estado.pendientes,
    };
  });
}
