import { z } from 'zod';
import { Contexto } from '../../contexto';
import { enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { evaluarAcompanamiento } from '../../domain/oportunidad';
import { MODALIDADES, fechaLocal, hoy } from '../../domain/reglas';
import { esFechaValida, nombreDelMes, rangoDelMes } from '../../domain/semanas';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';
import { exigirEstrategia } from '../estrategias/estrategias.servicio';
import { estadoDelPeriodo, obtenerPeriodoAbierto, rangoValidoDeAcompanamiento, validarPeriodo } from '../periodos/periodos.servicio';
import { EstrategiaBase } from '../estrategias/estrategias.servicio';
import { docentesDeEstrategia } from '../vinculacion/vinculacion.servicio';

export const esquemaAcompanamiento = z.object({
  anio: z.number().int(),
  mes: z.number().int().min(1).max(12),
  docenteId: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  modalidad: z.enum(MODALIDADES),
  tema: z.string().trim().min(3).max(200),
  observaciones: z.string().trim().min(5).max(2000),
  compromisos: z.string().trim().min(5).max(2000),
  avanceCompromisos: z.string().trim().max(2000).optional(),
  confirmarAdicional: z.boolean().optional(),
});
export type DatosAcompanamiento = z.infer<typeof esquemaAcompanamiento>;

interface FilaAcompanamiento {
  id: number;
  docenteId: number;
  docenteNombre: string;
  tipo: string;
  fecha: string;
  modalidad: string;
  tema: string;
  observaciones: string;
  compromisos: string;
  avanceCompromisos: string | null;
  sesionGrupalId: number | null;
  registradoPor: string;
  registradoEn: Date;
}

const SELECT_ACOMPANAMIENTO = `
  SELECT a.id, a.docente_id AS "docenteId", d.nombre AS "docenteNombre", a.tipo, a.fecha, a.modalidad, a.tema,
         a.observaciones, a.compromisos, a.avance_compromisos AS "avanceCompromisos",
         a.sesion_grupal_id AS "sesionGrupalId", u.nombre AS "registradoPor", a.registrado_en AS "registradoEn"
    FROM acompanamiento a
    JOIN docente d ON d.id = a.docente_id
    JOIN usuario u ON u.id = a.registrado_por
    JOIN periodo_mensual p ON p.id = a.periodo_id`;

/** Agrega a cada acompañamiento su medición de oportunidad, a partir de la marca de tiempo del servidor. */
function conOportunidad(fila: FilaAcompanamiento) {
  return { ...fila, ...evaluarAcompanamiento(fila.fecha, fechaLocal(fila.registradoEn)) };
}

export async function acompanamientosDelPeriodo(estrategiaId: number, anio: number, mes: number) {
  const { rows } = await pool.query(
    `${SELECT_ACOMPANAMIENTO}
      WHERE a.estrategia_id = $1 AND p.anio = $2 AND p.mes = $3
      ORDER BY a.fecha, a.id`,
    [estrategiaId, anio, mes],
  );
  return (rows as FilaAcompanamiento[]).map(conOportunidad);
}

/**
 * CU-07: población de docentes del periodo. Solo se listan los docentes asociados a la estrategia,
 * resueltos en la consulta y no en la interfaz (RQ_007), con sus acompañamientos del mes y los
 * compromisos pendientes del mes anterior.
 */
export async function docentesDelPeriodo(ctx: Contexto, estrategiaId: number, anio: number, mes: number) {
  const estrategia = await exigirEstrategia(pool, ctx, estrategiaId);
  validarPeriodo(estrategia, anio, mes);

  const [docentes, acompanamientos, anteriores, periodo] = await Promise.all([
    docentesDeEstrategia(pool, estrategiaId),
    acompanamientosDelPeriodo(estrategiaId, anio, mes),
    pool.query(
      `SELECT DISTINCT ON (a.docente_id) a.docente_id AS "docenteId", a.fecha, a.tema, a.compromisos
         FROM acompanamiento a
        WHERE a.estrategia_id = $1 AND a.fecha < $2
        ORDER BY a.docente_id, a.fecha DESC, a.id DESC`,
      [estrategiaId, rangoDelMes(anio, mes).inicio],
    ),
    estadoDelPeriodo(pool, estrategiaId, anio, mes),
  ]);

  const rango = rangoValidoDeAcompanamiento(estrategia, anio, mes);
  const lista = docentes.map((docente) => ({
    ...docente,
    acompanamientos: acompanamientos.filter((a) => a.docenteId === docente.id),
    compromisosAnteriores: anteriores.rows.find((a) => a.docenteId === docente.id) ?? null,
  }));

  return {
    estrategia: { id: estrategia.id, codigo: estrategia.codigo, nombre: estrategia.nombre, entidadNombre: estrategia.entidadNombre },
    periodo: { anio, mes, nombre: nombreDelMes(anio, mes), ...periodo },
    rangoValido: rango,
    docentes: lista,
    sesionesGrupales: agruparSesiones(acompanamientos),
    resumen: {
      asignados: lista.length,
      acompanados: lista.filter((d) => d.acompanamientos.length > 0).length,
    },
  };
}

/** CU-07 / RQ_007: registro del acompañamiento pedagógico individual. */
export async function registrarAcompanamiento(ctx: Contexto, estrategiaId: number, datos: DatosAcompanamiento) {
  return enTransaccion(async (tx) => {
    const estrategia = await exigirEstrategia(tx, ctx, estrategiaId);
    validarPeriodo(estrategia, datos.anio, datos.mes);

    // La población habilitada se obtiene a través del módulo de Vinculación (RN-04).
    const docentes = await docentesDeEstrategia(tx, estrategiaId);
    const docente = docentes.find((d) => d.id === datos.docenteId);
    if (!docente) {
      await registrarAuditoria(pool, ctx, {
        operacion: 'ACOMPANAMIENTO_RECHAZADO',
        entidadAfectada: 'ESTRATEGIA',
        registroId: estrategiaId,
        detalle: `Intento de registrar acompañamiento a un docente (id ${datos.docenteId}) que no está asociado a ${estrategia.codigo}`,
      });
      throw new AppError(
        403,
        'DOCENTE_AJENO',
        'El docente no está asociado a esta estrategia: solo puede acompañar a los docentes que tiene asignados.',
      );
    }

    validarFecha(estrategia, datos);

    const periodo = await obtenerPeriodoAbierto(tx, estrategiaId, datos.anio, datos.mes);

    // Si el docente ya tiene acompañamiento en el mes, no se duplica en silencio: se advierte.
    const existentes = await tx.query(
      `SELECT a.id, a.fecha, a.tema, u.nombre AS "registradoPor"
         FROM acompanamiento a JOIN usuario u ON u.id = a.registrado_por
        WHERE a.periodo_id = $1 AND a.docente_id = $2 AND a.tipo = 'INDIVIDUAL'
        ORDER BY a.fecha`,
      [periodo.id, datos.docenteId],
    );
    if (existentes.rowCount && !datos.confirmarAdicional) {
      throw new AppError(
        409,
        'ACOMPANAMIENTO_EXISTENTE',
        `${docente.nombre} ya tiene ${existentes.rowCount} acompañamiento(s) registrado(s) en ${nombreDelMes(datos.anio, datos.mes)}. Puede consultarlo o complementarlo con una nueva sesión del mismo periodo.`,
        { existentes: existentes.rows },
      );
    }

    // registrado_en lo asigna el servidor (DEFAULT now()): nunca se toma la hora del cliente.
    const insercion = await tx.query(
      `INSERT INTO acompanamiento
         (periodo_id, estrategia_id, docente_id, tipo, fecha, modalidad, tema, observaciones, compromisos, avance_compromisos, registrado_por)
       VALUES ($1, $2, $3, 'INDIVIDUAL', $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, registrado_en AS "registradoEn"`,
      [
        periodo.id,
        estrategiaId,
        datos.docenteId,
        datos.fecha,
        datos.modalidad,
        datos.tema,
        datos.observaciones,
        datos.compromisos,
        datos.avanceCompromisos || null,
        ctx.usuario.id,
      ],
    );
    const { id, registradoEn } = insercion.rows[0] as { id: number; registradoEn: Date };

    await registrarAuditoria(tx, ctx, {
      operacion: 'REGISTRAR_ACOMPANAMIENTO',
      entidadAfectada: 'ACOMPANAMIENTO',
      registroId: id,
      valoresNuevos: {
        estrategia: estrategia.codigo,
        periodo: `${datos.anio}-${String(datos.mes).padStart(2, '0')}`,
        docente: docente.nombre,
        tipo: 'INDIVIDUAL',
        fecha: datos.fecha,
        modalidad: datos.modalidad,
        tema: datos.tema,
        compromisos: datos.compromisos,
      },
      detalle: `Acompañamiento individual a ${docente.nombre} en ${estrategia.codigo}${existentes.rowCount ? ' (sesión adicional del mismo periodo)' : ''}`,
    });

    return {
      id,
      docenteId: docente.id,
      docenteNombre: docente.nombre,
      fecha: datos.fecha,
      registradoPor: ctx.usuario.nombre,
      registradoEn,
      ...evaluarAcompanamiento(datos.fecha, fechaLocal(registradoEn)),
    };
  });
}

/** La fecha del acompañamiento debe pertenecer al periodo, a la vigencia de la estrategia y no ser futura. */
function validarFecha(estrategia: EstrategiaBase, datos: { anio: number; mes: number; fecha: string }) {
  const rango = rangoValidoDeAcompanamiento(estrategia, datos.anio, datos.mes);
  if (!esFechaValida(datos.fecha)) {
    throw new AppError(400, 'FECHA_INVALIDA', 'La fecha del acompañamiento no es válida.', { rangoValido: rango });
  }
  if (datos.fecha > hoy()) {
    throw new AppError(
      400,
      'FECHA_FUTURA',
      `No puede registrarse un acompañamiento que aún no ha ocurrido. El rango válido es del ${rango.desde} al ${rango.hasta}.`,
      { rangoValido: rango, campos: { fecha: 'No puede ser una fecha futura' } },
    );
  }
  if (datos.fecha < rango.desde || datos.fecha > rango.hasta) {
    throw new AppError(
      400,
      'FECHA_FUERA_DE_PERIODO',
      `La fecha no pertenece al periodo ${nombreDelMes(datos.anio, datos.mes)}. El rango válido es del ${rango.desde} al ${rango.hasta}.`,
      { rangoValido: rango, campos: { fecha: 'Fuera del periodo seleccionado' } },
    );
  }
}

/** Agrupa los acompañamientos que provienen de una misma jornada colectiva. */
function agruparSesiones(acompanamientos: ReturnType<typeof conOportunidad>[]) {
  const sesiones = new Map<number, { id: number; fecha: string; tema: string; modalidad: string; registradoPor: string; registradoEn: Date; oportuno: boolean; diasRetraso: number; asistentes: string[] }>();
  for (const a of acompanamientos) {
    if (!a.sesionGrupalId) continue;
    const sesion = sesiones.get(a.sesionGrupalId) ?? {
      id: a.sesionGrupalId, fecha: a.fecha, tema: a.tema, modalidad: a.modalidad, registradoPor: a.registradoPor,
      registradoEn: a.registradoEn, oportuno: a.oportuno, diasRetraso: a.diasRetraso, asistentes: [],
    };
    sesion.asistentes.push(a.docenteNombre);
    sesiones.set(a.sesionGrupalId, sesion);
  }
  return [...sesiones.values()].sort((x, y) => x.fecha.localeCompare(y.fecha));
}

export const esquemaAcompanamientoGrupal = z.object({
  anio: z.number().int(),
  mes: z.number().int().min(1).max(12),
  docenteIds: z.array(z.number().int().positive()).min(1).max(100),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  modalidad: z.enum(MODALIDADES),
  tema: z.string().trim().min(3).max(200),
  observaciones: z.string().trim().min(5).max(2000),
  compromisos: z.string().trim().min(5).max(2000),
  confirmarCoincidencia: z.boolean().optional(),
});
export type DatosAcompanamientoGrupal = z.infer<typeof esquemaAcompanamientoGrupal>;

/**
 * CU-08 / RQ_008: una jornada colectiva genera, en una sola transacción, un acompañamiento por cada
 * docente asistente, agrupados bajo la misma sesión. Los docentes no marcados no reciben registro.
 */
export async function registrarAcompanamientoGrupal(ctx: Contexto, estrategiaId: number, datos: DatosAcompanamientoGrupal) {
  const ids = [...new Set(datos.docenteIds)];
  if (ids.length < 2) {
    throw new AppError(
      400,
      'MINIMO_DOS_ASISTENTES',
      'Un acompañamiento grupal requiere al menos dos docentes asistentes. Para un solo docente use el registro individual.',
      { campos: { docenteIds: 'Marque al menos dos docentes' } },
    );
  }
  return enTransaccion(async (tx) => {
    const estrategia = await exigirEstrategia(tx, ctx, estrategiaId);
    validarPeriodo(estrategia, datos.anio, datos.mes);

    const docentes = await docentesDeEstrategia(tx, estrategiaId);
    const ajenos = ids.filter((id) => !docentes.some((d) => d.id === id));
    if (ajenos.length) {
      await registrarAuditoria(pool, ctx, {
        operacion: 'ACOMPANAMIENTO_RECHAZADO',
        entidadAfectada: 'ESTRATEGIA',
        registroId: estrategiaId,
        detalle: `Intento de registrar una sesión grupal con docentes (id ${ajenos.join(', ')}) que no están asociados a ${estrategia.codigo}`,
      });
      throw new AppError(403, 'DOCENTE_AJENO', 'Alguno de los docentes no está asociado a esta estrategia: solo puede acompañar a los que tiene asignados.');
    }
    validarFecha(estrategia, datos);
    const periodo = await obtenerPeriodoAbierto(tx, estrategiaId, datos.anio, datos.mes);

    // Otra sesión grupal el mismo día para alguno de los docentes: se advierte y se pide confirmación.
    const coincidencias = await tx.query(
      `SELECT DISTINCT d.nombre, g.tema
         FROM acompanamiento a JOIN sesion_grupal g ON g.id = a.sesion_grupal_id JOIN docente d ON d.id = a.docente_id
        WHERE a.estrategia_id = $1 AND a.fecha = $2 AND a.docente_id = ANY($3::int[])`,
      [estrategiaId, datos.fecha, ids],
    );
    if (coincidencias.rowCount && !datos.confirmarCoincidencia) {
      throw new AppError(
        409,
        'SESION_GRUPAL_EXISTENTE',
        `Ya hay una sesión grupal registrada el ${datos.fecha} para: ${coincidencias.rows.map((r) => r.nombre).join(', ')}. Confirme que se trata de otra jornada.`,
        { coincidencias: coincidencias.rows },
      );
    }

    const sesion = await tx.query(
      `INSERT INTO sesion_grupal (periodo_id, estrategia_id, fecha, modalidad, tema, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, registrado_en AS "registradoEn"`,
      [periodo.id, estrategiaId, datos.fecha, datos.modalidad, datos.tema, ctx.usuario.id],
    );
    const { id: sesionId, registradoEn } = sesion.rows[0] as { id: number; registradoEn: Date };
    await tx.query(
      `INSERT INTO acompanamiento
         (periodo_id, estrategia_id, docente_id, tipo, fecha, modalidad, tema, observaciones, compromisos, sesion_grupal_id, registrado_por, registrado_en)
       SELECT $1, $2, unnest($3::int[]), 'GRUPAL', $4, $5, $6, $7, $8, $9, $10, $11`,
      [periodo.id, estrategiaId, ids, datos.fecha, datos.modalidad, datos.tema, datos.observaciones, datos.compromisos, sesionId, ctx.usuario.id, registradoEn],
    );
    const asistentes = docentes.filter((d) => ids.includes(d.id)).map((d) => d.nombre);
    await registrarAuditoria(tx, ctx, {
      operacion: 'REGISTRAR_ACOMPANAMIENTO_GRUPAL',
      entidadAfectada: 'ACOMPANAMIENTO',
      registroId: sesionId,
      valoresNuevos: {
        estrategia: estrategia.codigo,
        periodo: `${datos.anio}-${String(datos.mes).padStart(2, '0')}`,
        fecha: datos.fecha,
        tema: datos.tema,
        asistentes,
      },
      detalle: `Sesión grupal en ${estrategia.codigo} con ${asistentes.length} docentes: se generó un acompañamiento para cada asistente`,
    });
    return {
      sesionId,
      asistentes,
      registros: asistentes.length,
      registradoEn,
      ...evaluarAcompanamiento(datos.fecha, fechaLocal(registradoEn)),
    };
  });
}
