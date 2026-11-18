import { z } from 'zod';
import { Contexto } from '../../contexto';
import { Ejecutor, enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { DIAS_PLAZO_CIERRE, hoy } from '../../domain/reglas';
import { nombreDelMes, rangoDelMes, sumarDias } from '../../domain/semanas';
import { acompanamientosDelPeriodo } from '../acompanamiento/acompanamiento.servicio';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';
import { EstrategiaBase, exigirEstrategia, predicadoDeAmbito } from '../estrategias/estrategias.servicio';
import { estadoDelPeriodo, validarPeriodo } from '../periodos/periodos.servicio';
import { estadoSemanal } from '../seguimiento/seguimiento.servicio';
import { docentesDeEstrategia } from '../vinculacion/vinculacion.servicio';

/**
 * CU-10 / RQ_010: cierre del periodo mensual.
 * El cierre consulta primero los acompañamientos y después pide al seguimiento semanal la cobertura
 * del mes: con ambas respuestas construye el resumen que se le presenta al tutor (diagrama 2.8).
 */

export const esquemaCierre = z.object({ justificacion: z.string().trim().max(2000).optional() });
export const esquemaReapertura = z.object({ motivo: z.string().trim().min(10).max(1000) });
export const esquemaDecisionReapertura = z.object({ aprobar: z.boolean(), respuesta: z.string().trim().min(5).max(1000) });

/** Plazo para cerrar el periodo dentro del término: cinco días después del último día del mes. */
export function plazoDeCierre(anio: number, mes: number): string {
  return sumarDias(rangoDelMes(anio, mes).fin, DIAS_PLAZO_CIERRE);
}

async function construirResumen(db: Ejecutor, estrategia: EstrategiaBase, anio: number, mes: number) {
  const [acompanamientos, docentes, semanal] = await Promise.all([
    acompanamientosDelPeriodo(estrategia.id, anio, mes),
    docentesDeEstrategia(db, estrategia.id),
    estadoSemanal(db, estrategia, anio, mes),
  ]);
  const acompanados = new Set(acompanamientos.map((a) => a.docenteId));
  const sesionesGrupales = new Set(acompanamientos.filter((a) => a.sesionGrupalId).map((a) => a.sesionGrupalId)).size;
  const sinReporte = semanal.semanas.filter((s) => !s.seguimiento);
  const sinAcompanamiento = docentes.filter((d) => !acompanados.has(d.id));
  return {
    docentesAsignados: docentes.length,
    docentesAcompanados: acompanados.size,
    acompanamientosIndividuales: acompanamientos.filter((a) => a.tipo === 'INDIVIDUAL').length,
    sesionesGrupales,
    semanasEsperadas: semanal.semanas.length,
    semanasReportadas: semanal.semanas.length - sinReporte.length,
    semanasSinActividad: semanal.semanas.filter((s) => s.estado === 'SIN_ACTIVIDAD').length,
    semanasPendientes: sinReporte.map((s) => ({ semanaIso: s.semanaIso, inicio: s.inicio, fin: s.fin })),
    docentesSinAcompanamiento: sinAcompanamiento.map((d) => d.nombre),
    registros: acompanamientos.length + semanal.semanas.filter((s) => s.seguimiento).length,
    completo: sinReporte.length === 0 && sinAcompanamiento.length === 0,
    // Lo que había al cerrar: se conserva si después se reabre (RQ_010).
    detalle: {
      seguimientos: semanal.semanas.filter((s) => s.seguimiento).map((s) => ({
        semana: s.semanaIso, estado: s.estado, registradoEn: s.seguimiento!.registradoEn, version: s.seguimiento!.version,
      })),
      acompanamientos: acompanamientos.map((a) => ({ id: a.id, docente: a.docenteNombre, tipo: a.tipo, fecha: a.fecha, registradoEn: a.registradoEn })),
    },
  };
}

/** Resumen previo al cierre: con frecuencia es ahí donde el tutor advierte lo que olvidó registrar. */
export async function resumenDeCierre(ctx: Contexto, estrategiaId: number, anio: number, mes: number) {
  const estrategia = await exigirEstrategia(pool, ctx, estrategiaId);
  validarPeriodo(estrategia, anio, mes);
  const [resumen, periodo] = await Promise.all([
    construirResumen(pool, estrategia, anio, mes),
    estadoDelPeriodo(pool, estrategiaId, anio, mes),
  ]);
  const fechaHoy = hoy();
  const plazo = plazoDeCierre(anio, mes);
  const { detalle: _detalle, ...visible } = resumen;
  return {
    periodo: { anio, mes, nombre: nombreDelMes(anio, mes), ...periodo },
    resumen: visible,
    mesTerminado: rangoDelMes(anio, mes).fin < fechaHoy,
    plazo,
    extemporaneo: fechaHoy > plazo,
  };
}

export async function cerrarPeriodo(ctx: Contexto, estrategiaId: number, anio: number, mes: number, datos: z.infer<typeof esquemaCierre>) {
  return enTransaccion(async (tx) => {
    const estrategia = await exigirEstrategia(tx, ctx, estrategiaId, { bloquear: true });
    validarPeriodo(estrategia, anio, mes);
    const nombre = nombreDelMes(anio, mes);
    const fechaHoy = hoy();

    const actual = await estadoDelPeriodo(tx, estrategiaId, anio, mes);
    if (actual.estado === 'CERRADO') {
      throw new AppError(
        409,
        'PERIODO_YA_CERRADO',
        `El periodo ${nombre} ya fue cerrado por ${actual.cerradoPor}. Si necesita corregirlo, solicite su reapertura.`,
        { cerradoPor: actual.cerradoPor, cerradoEn: actual.cerradoEn },
      );
    }
    if (rangoDelMes(anio, mes).fin >= fechaHoy) {
      throw new AppError(409, 'PERIODO_EN_CURSO', `El periodo ${nombre} aún no ha terminado: podrá cerrarse a partir del día siguiente a su último día.`);
    }

    const resumen = await construirResumen(tx, estrategia, anio, mes);
    if (resumen.registros === 0) {
      throw new AppError(
        409,
        'PERIODO_VACIO',
        'El periodo no tiene ningún registro: un periodo vacío no constituye información. Registre lo realizado o reporte las semanas sin actividad con su causa.',
      );
    }
    const justificacion = datos.justificacion?.trim() || null;
    if (!resumen.completo && (!justificacion || justificacion.length < 10)) {
      throw new AppError(
        400,
        'JUSTIFICACION_REQUERIDA',
        'Hay semanas sin reportar o docentes sin acompañamiento. Puede cerrar el periodo, pero debe registrar la justificación.',
        {
          campos: { justificacion: 'Explique por qué quedaron así (mínimo 10 caracteres)' },
          semanasPendientes: resumen.semanasPendientes,
          docentesSinAcompanamiento: resumen.docentesSinAcompanamiento,
        },
      );
    }

    const extemporaneo = fechaHoy > plazoDeCierre(anio, mes);
    await tx.query(
      `INSERT INTO periodo_mensual (estrategia_id, anio, mes) VALUES ($1, $2, $3) ON CONFLICT (estrategia_id, anio, mes) DO NOTHING`,
      [estrategiaId, anio, mes],
    );
    await tx.query(
      `UPDATE periodo_mensual
          SET estado = 'CERRADO', cerrado_por = $4, cerrado_en = now(), justificacion_cierre = $5,
              extemporaneo = $6, resumen_cierre = $7
        WHERE estrategia_id = $1 AND anio = $2 AND mes = $3`,
      [estrategiaId, anio, mes, ctx.usuario.id, justificacion, extemporaneo, JSON.stringify(resumen)],
    );
    const { detalle: _detalle, ...visible } = resumen;
    await registrarAuditoria(tx, ctx, {
      operacion: 'CERRAR_PERIODO',
      entidadAfectada: 'PERIODO_MENSUAL',
      registroId: `${estrategia.codigo} ${anio}-${String(mes).padStart(2, '0')}`,
      valoresPrevios: { estado: 'ABIERTO' },
      valoresNuevos: { estado: 'CERRADO', extemporaneo, justificacion, ...visible },
      detalle: `Periodo ${nombre} de ${estrategia.codigo} cerrado${extemporaneo ? ' de forma extemporánea' : ''}${justificacion ? ' con justificación' : ''}`,
    });
    return { periodo: nombre, estado: 'CERRADO', extemporaneo, justificacion, resumen: visible };
  });
}

/** El periodo cerrado no se modifica mientras se decide: la solicitud va al tutor líder. */
export async function solicitarReapertura(ctx: Contexto, estrategiaId: number, anio: number, mes: number, datos: z.infer<typeof esquemaReapertura>) {
  return enTransaccion(async (tx) => {
    const estrategia = await exigirEstrategia(tx, ctx, estrategiaId);
    const periodo = await estadoDelPeriodo(tx, estrategiaId, anio, mes);
    if (periodo.estado !== 'CERRADO' || !periodo.id) {
      throw new AppError(409, 'PERIODO_ABIERTO', 'El periodo está abierto: puede registrar y editar sin pedir reapertura.');
    }
    if (periodo.reaperturaPendiente) {
      throw new AppError(409, 'REAPERTURA_PENDIENTE', 'Ya hay una solicitud de reapertura en trámite para este periodo.');
    }
    const { rows } = await tx.query(
      `INSERT INTO solicitud_reapertura (periodo_id, solicitado_por, motivo) VALUES ($1, $2, $3) RETURNING id, creado_en AS "creadoEn"`,
      [periodo.id, ctx.usuario.id, datos.motivo],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'SOLICITAR_REAPERTURA',
      entidadAfectada: 'PERIODO_MENSUAL',
      registroId: `${estrategia.codigo} ${anio}-${String(mes).padStart(2, '0')}`,
      valoresNuevos: { motivo: datos.motivo },
      detalle: `Reapertura del periodo ${nombreDelMes(anio, mes)} de ${estrategia.codigo} solicitada; el periodo sigue cerrado mientras se decide`,
    });
    return { id: rows[0].id, estado: 'RADICADA' };
  });
}

export async function listarReaperturas(ctx: Contexto) {
  const params: unknown[] = [];
  const { rows } = await pool.query(
    `SELECT r.id, r.motivo, r.estado, r.creado_en AS "creadoEn", r.respuesta, r.resuelto_en AS "resueltoEn",
            u.nombre AS "solicitadoPor", x.nombre AS "resueltoPor",
            p.anio, p.mes, p.cerrado_en AS "cerradoEn", p.extemporaneo, p.justificacion_cierre AS "justificacionCierre",
            e.id AS "estrategiaId", e.codigo, e.nombre AS "estrategiaNombre", en.nombre AS "entidadNombre"
       FROM solicitud_reapertura r
       JOIN periodo_mensual p ON p.id = r.periodo_id
       JOIN estrategia e ON e.id = p.estrategia_id
       JOIN entidad en ON en.id = e.entidad_id
       JOIN usuario u ON u.id = r.solicitado_por
       LEFT JOIN usuario x ON x.id = r.resuelto_por
      WHERE ${predicadoDeAmbito(ctx, params)}
      ORDER BY (r.estado = 'RADICADA') DESC, r.id DESC`,
    params,
  );
  return rows.map((r) => ({ ...r, periodo: nombreDelMes(r.anio, r.mes) }));
}

/** Aprobada la reapertura, se conserva la versión cerrada, se habilita la edición y el periodo queda como corregido. */
export async function resolverReapertura(ctx: Contexto, solicitudId: number, datos: z.infer<typeof esquemaDecisionReapertura>) {
  return enTransaccion(async (tx) => {
    const { rows } = await tx.query(
      `SELECT r.id, r.estado, r.periodo_id AS "periodoId", p.estrategia_id AS "estrategiaId", p.anio, p.mes
         FROM solicitud_reapertura r JOIN periodo_mensual p ON p.id = r.periodo_id
        WHERE r.id = $1 FOR UPDATE OF r`,
      [solicitudId],
    );
    const solicitud = rows[0];
    if (!solicitud) throw new AppError(404, 'SOLICITUD_NO_ENCONTRADA', 'La solicitud no existe.');
    const estrategia = await exigirEstrategia(tx, ctx, solicitud.estrategiaId);
    if (solicitud.estado !== 'RADICADA') throw new AppError(409, 'SOLICITUD_RESUELTA', 'La solicitud ya fue resuelta.');

    const estado = datos.aprobar ? 'APROBADA' : 'RECHAZADA';
    await tx.query(
      `UPDATE solicitud_reapertura SET estado = $2, respuesta = $3, resuelto_por = $4, resuelto_en = now() WHERE id = $1`,
      [solicitudId, estado, datos.respuesta, ctx.usuario.id],
    );
    const nombre = nombreDelMes(solicitud.anio, solicitud.mes);
    if (datos.aprobar) {
      const cerrado = await tx.query(
        `SELECT version, estado, cerrado_por AS "cerradoPor", cerrado_en AS "cerradoEn", justificacion_cierre AS "justificacionCierre",
                extemporaneo, resumen_cierre AS "resumenCierre"
           FROM periodo_mensual WHERE id = $1 FOR UPDATE`,
        [solicitud.periodoId],
      );
      await tx.query(
        `INSERT INTO periodo_version (periodo_id, version, datos, reabierto_por) VALUES ($1, $2, $3, $4)`,
        [solicitud.periodoId, cerrado.rows[0].version, JSON.stringify(cerrado.rows[0]), ctx.usuario.id],
      );
      await tx.query(
        `UPDATE periodo_mensual
            SET estado = 'ABIERTO', corregido = TRUE, version = version + 1,
                cerrado_por = NULL, cerrado_en = NULL, justificacion_cierre = NULL, resumen_cierre = NULL
          WHERE id = $1`,
        [solicitud.periodoId],
      );
    }
    await registrarAuditoria(tx, ctx, {
      operacion: datos.aprobar ? 'APROBAR_REAPERTURA' : 'RECHAZAR_REAPERTURA',
      entidadAfectada: 'PERIODO_MENSUAL',
      registroId: `${estrategia.codigo} ${solicitud.anio}-${String(solicitud.mes).padStart(2, '0')}`,
      valoresPrevios: { estado: 'CERRADO' },
      valoresNuevos: { estado: datos.aprobar ? 'ABIERTO (corregido)' : 'CERRADO', respuesta: datos.respuesta },
      detalle: datos.aprobar
        ? `Reapertura del periodo ${nombre} de ${estrategia.codigo} aprobada: la versión cerrada se conserva y el periodo queda marcado como corregido`
        : `Reapertura del periodo ${nombre} de ${estrategia.codigo} rechazada: el periodo sigue cerrado`,
    });
    return { id: solicitudId, estado };
  });
}
