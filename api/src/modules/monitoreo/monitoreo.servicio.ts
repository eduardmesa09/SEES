import { z } from 'zod';
import { Contexto } from '../../contexto';
import { enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';
import { UMBRAL_P95_MS, conectadosAhora, resumenDeOperacion, serieReciente } from './metricas';

/** Tiempo tras el cual un incidente sin resolver se escala y se marca como crítico (CU-15). */
export const MINUTOS_ESCALAMIENTO = 30;

/** Verificación de los servicios: API, base de datos y capacidad del pool de conexiones. */
export async function verificarServicios() {
  const inicio = Date.now();
  let baseDeDatos: { disponible: boolean; latenciaMs: number; detalle: string };
  try {
    const { rows } = await pool.query(`SELECT version() AS v, (SELECT count(*) FROM pg_stat_activity)::int AS conexiones`);
    baseDeDatos = {
      disponible: true,
      latenciaMs: Date.now() - inicio,
      detalle: `${String(rows[0].v).split(' ').slice(0, 2).join(' ')} · ${rows[0].conexiones} conexiones abiertas`,
    };
  } catch (error) {
    baseDeDatos = { disponible: false, latenciaMs: Date.now() - inicio, detalle: (error as Error).message };
  }
  const memoria = process.memoryUsage();
  const capacidad = {
    conexionesEnUso: pool.totalCount - pool.idleCount,
    conexionesMaximas: 10,
    memoriaMb: Math.round(memoria.rss / 1048576),
    disponible: pool.waitingCount === 0,
  };
  const servicios = [
    { nombre: 'API del Piloto', disponible: true, detalle: `En ejecución hace ${Math.round(process.uptime() / 60)} min` },
    { nombre: 'Base de datos', disponible: baseDeDatos.disponible, detalle: `${baseDeDatos.detalle} · ${baseDeDatos.latenciaMs} ms` },
    {
      nombre: 'Capacidad',
      disponible: capacidad.disponible,
      detalle: `${capacidad.conexionesEnUso} de ${capacidad.conexionesMaximas} conexiones en uso · ${capacidad.memoriaMb} MB de memoria`,
    },
  ];
  return { servicios, todosDisponibles: servicios.every((s) => s.disponible), verificadoEn: new Date().toISOString() };
}

/** Consola en tiempo real: servicios, conectados, tiempos de respuesta, errores repetidos y regiones. */
export async function estadoDeOperacion() {
  const operacion = resumenDeOperacion(Date.now() - 15 * 60_000);
  return {
    ...(await verificarServicios()),
    conectados: conectadosAhora(),
    ultimos15Minutos: operacion,
    umbralP95Ms: UMBRAL_P95_MS,
    alerta: operacion.p95 > UMBRAL_P95_MS
      ? `El percentil 95 del tiempo de respuesta (${operacion.p95} ms) supera el umbral comprometido de ${UMBRAL_P95_MS} ms. Registre la acción de contención aplicada.`
      : null,
    serie: serieReciente(30),
    sesionActiva: (await listarSesiones()).find((s) => s.estado === 'INICIADA') ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// Sesiones programadas del pilotaje
// ---------------------------------------------------------------------------------------

export const esquemaSesion = z.object({ nombre: z.string().trim().min(5).max(150) });
export const esquemaRetraso = z.object({ causa: z.string().trim().min(5).max(500) });
export const esquemaIncidente = z.object({
  usuarioAfectado: z.string().trim().min(3).max(150),
  region: z.string().trim().min(3).max(80),
  descripcion: z.string().trim().min(5).max(1000),
  accion: z.string().trim().min(5).max(1000),
  completoRegistro: z.boolean(),
  ocurridoEn: z.string().datetime({ offset: true }).optional(),
});
export const esquemaCierreSesion = z.object({
  suspendida: z.boolean().default(false),
  causa: z.string().trim().max(1000).optional(),
});

function conEscalamiento<T extends { resueltoEn: Date | null; ocurridoEn: Date }>(incidente: T) {
  const fin = incidente.resueltoEn ? new Date(incidente.resueltoEn).getTime() : Date.now();
  const minutos = Math.round((fin - new Date(incidente.ocurridoEn).getTime()) / 60_000);
  return { ...incidente, minutosSolucion: incidente.resueltoEn ? minutos : null, critico: minutos > MINUTOS_ESCALAMIENTO, minutosAbierto: minutos };
}

export async function listarSesiones() {
  const { rows } = await pool.query(
    `SELECT s.id, s.nombre, s.estado, s.verificacion, s.verificada_en AS "verificadaEn", s.causa_retraso AS "causaRetraso",
            s.iniciada_en AS "iniciadaEn", s.finalizada_en AS "finalizadaEn", s.causa_cierre AS "causaCierre", s.reporte,
            s.creada_en AS "creadaEn", u.nombre AS "creadaPor",
            (SELECT count(*) FROM incidente i WHERE i.sesion_id = s.id)::int AS incidentes
       FROM sesion_pilotaje s JOIN usuario u ON u.id = s.creada_por
      ORDER BY s.id DESC`,
  );
  return rows;
}

export async function detalleDeSesion(id: number) {
  const sesion = (await listarSesiones()).find((s) => s.id === id);
  if (!sesion) throw new AppError(404, 'SESION_NO_ENCONTRADA', 'La sesión no existe.');
  const { rows } = await pool.query(
    `SELECT i.id, i.ocurrido_en AS "ocurridoEn", i.usuario_afectado AS "usuarioAfectado", i.region, i.descripcion, i.accion,
            i.completo_registro AS "completoRegistro", i.resuelto_en AS "resueltoEn", u.nombre AS "registradoPor"
       FROM incidente i JOIN usuario u ON u.id = i.registrado_por WHERE i.sesion_id = $1 ORDER BY i.ocurrido_en DESC`,
    [id],
  );
  const desde = sesion.iniciadaEn ? new Date(sesion.iniciadaEn).getTime() : null;
  const hasta = sesion.finalizadaEn ? new Date(sesion.finalizadaEn).getTime() : Date.now();
  return {
    ...sesion,
    incidentes: rows.map(conEscalamiento),
    operacion: sesion.reporte?.operacion ?? (desde ? resumenDeOperacion(desde, hasta) : null),
  };
}

async function exigirSesion(tx: Pick<typeof pool, 'query'>, id: number) {
  const { rows } = await tx.query(`SELECT id, nombre, estado, verificacion FROM sesion_pilotaje WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows[0]) throw new AppError(404, 'SESION_NO_ENCONTRADA', 'La sesión no existe.');
  return rows[0] as { id: number; nombre: string; estado: string; verificacion: { todosDisponibles: boolean } | null };
}

export async function programarSesion(ctx: Contexto, datos: z.infer<typeof esquemaSesion>) {
  const { rows } = await pool.query(`INSERT INTO sesion_pilotaje (nombre, creada_por) VALUES ($1, $2) RETURNING id`, [datos.nombre, ctx.usuario.id]);
  await registrarAuditoria(pool, ctx, { operacion: 'PROGRAMAR_SESION', entidadAfectada: 'SESION_PILOTAJE', registroId: rows[0].id, detalle: `Sesión "${datos.nombre}" programada` });
  return { id: rows[0].id };
}

/** Verificación previa: queda registrada con su resultado. */
export async function verificarSesion(ctx: Contexto, id: number) {
  return enTransaccion(async (tx) => {
    const sesion = await exigirSesion(tx, id);
    if (!['PROGRAMADA', 'RETRASADA'].includes(sesion.estado)) throw new AppError(409, 'SESION_YA_INICIADA', 'La sesión ya fue iniciada.');
    const verificacion = await verificarServicios();
    await tx.query(`UPDATE sesion_pilotaje SET verificacion = $2, verificada_en = now() WHERE id = $1`, [id, JSON.stringify(verificacion)]);
    await registrarAuditoria(tx, ctx, {
      operacion: 'VERIFICAR_SESION',
      entidadAfectada: 'SESION_PILOTAJE',
      registroId: id,
      valoresNuevos: verificacion,
      detalle: `Verificación previa de "${sesion.nombre}": ${verificacion.todosDisponibles ? 'todos los servicios disponibles' : 'hay servicios no disponibles'}`,
    });
    return verificacion;
  });
}

/** No se inicia una sesión sobre un servicio caído: invalidaría la medición. */
export async function iniciarSesion(ctx: Contexto, id: number) {
  return enTransaccion(async (tx) => {
    const sesion = await exigirSesion(tx, id);
    if (!['PROGRAMADA', 'RETRASADA'].includes(sesion.estado)) throw new AppError(409, 'SESION_YA_INICIADA', 'La sesión ya fue iniciada.');
    if (!sesion.verificacion) throw new AppError(409, 'SIN_VERIFICACION', 'Antes de iniciar la sesión debe registrar la verificación previa de los servicios.');
    if (!sesion.verificacion.todosDisponibles) {
      throw new AppError(409, 'SERVICIOS_NO_DISPONIBLES', 'La verificación previa encontró servicios no disponibles: registre el retraso con su causa y alerte al Líder Técnico.');
    }
    const activa = await tx.query(`SELECT 1 FROM sesion_pilotaje WHERE estado = 'INICIADA' AND id <> $1`, [id]);
    if (activa.rowCount) throw new AppError(409, 'OTRA_SESION_ACTIVA', 'Ya hay otra sesión en curso. Finalícela antes de iniciar esta.');
    await tx.query(`UPDATE sesion_pilotaje SET estado = 'INICIADA', iniciada_en = now() WHERE id = $1`, [id]);
    await registrarAuditoria(tx, ctx, { operacion: 'INICIAR_SESION_PILOTAJE', entidadAfectada: 'SESION_PILOTAJE', registroId: id, detalle: `Sesión "${sesion.nombre}" iniciada` });
    return { id, estado: 'INICIADA' };
  });
}

export async function registrarRetraso(ctx: Contexto, id: number, datos: z.infer<typeof esquemaRetraso>) {
  return enTransaccion(async (tx) => {
    const sesion = await exigirSesion(tx, id);
    if (!['PROGRAMADA', 'RETRASADA'].includes(sesion.estado)) throw new AppError(409, 'SESION_YA_INICIADA', 'La sesión ya fue iniciada.');
    await tx.query(`UPDATE sesion_pilotaje SET estado = 'RETRASADA', causa_retraso = $2 WHERE id = $1`, [id, datos.causa]);
    await registrarAuditoria(tx, ctx, {
      operacion: 'RETRASAR_SESION_PILOTAJE',
      entidadAfectada: 'SESION_PILOTAJE',
      registroId: id,
      detalle: `Sesión "${sesion.nombre}" retrasada: ${datos.causa}. Alerta enviada al Líder Técnico`,
    });
    return { id, estado: 'RETRASADA' };
  });
}

export async function registrarIncidente(ctx: Contexto, id: number, datos: z.infer<typeof esquemaIncidente>) {
  return enTransaccion(async (tx) => {
    const sesion = await exigirSesion(tx, id);
    if (sesion.estado !== 'INICIADA') throw new AppError(409, 'SESION_NO_INICIADA', 'Los incidentes se registran durante una sesión en curso.');
    const { rows } = await tx.query(
      `INSERT INTO incidente (sesion_id, ocurrido_en, usuario_afectado, region, descripcion, accion, completo_registro, registrado_por)
       VALUES ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, $7, $8) RETURNING id`,
      [id, datos.ocurridoEn ?? null, datos.usuarioAfectado, datos.region, datos.descripcion, datos.accion, datos.completoRegistro, ctx.usuario.id],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'REGISTRAR_INCIDENTE',
      entidadAfectada: 'SESION_PILOTAJE',
      registroId: id,
      valoresNuevos: datos,
      detalle: `Incidente de ${datos.usuarioAfectado} (${datos.region}) en "${sesion.nombre}": ${datos.completoRegistro ? 'completó' : 'no completó'} su registro`,
    });
    return { id: rows[0].id };
  });
}

export async function resolverIncidente(ctx: Contexto, sesionId: number, incidenteId: number) {
  const { rows } = await pool.query(
    `UPDATE incidente SET resuelto_en = now() WHERE id = $1 AND sesion_id = $2 AND resuelto_en IS NULL
     RETURNING ocurrido_en AS "ocurridoEn", resuelto_en AS "resueltoEn"`,
    [incidenteId, sesionId],
  );
  if (!rows[0]) throw new AppError(404, 'INCIDENTE_NO_ENCONTRADO', 'El incidente no existe o ya fue resuelto.');
  const resultado = conEscalamiento(rows[0]);
  await registrarAuditoria(pool, ctx, {
    operacion: 'RESOLVER_INCIDENTE',
    entidadAfectada: 'SESION_PILOTAJE',
    registroId: sesionId,
    detalle: `Incidente ${incidenteId} resuelto en ${resultado.minutosSolucion} min${resultado.critico ? ' (crítico: superó el tiempo de escalamiento)' : ''}`,
  });
  return resultado;
}

/** Al finalizar (o suspender) se genera y conserva el reporte de comportamiento técnico. */
export async function finalizarSesion(ctx: Contexto, id: number, datos: z.infer<typeof esquemaCierreSesion>) {
  if (datos.suspendida && (!datos.causa || datos.causa.length < 5)) {
    throw new AppError(400, 'CAUSA_REQUERIDA', 'Indique la causa de la suspensión y el punto en que quedó la sesión.', { campos: { causa: 'Campo obligatorio' } });
  }
  return enTransaccion(async (tx) => {
    const sesion = await exigirSesion(tx, id);
    if (sesion.estado !== 'INICIADA') throw new AppError(409, 'SESION_NO_INICIADA', 'Solo se puede cerrar una sesión en curso.');
    const { rows } = await tx.query(`SELECT iniciada_en AS "iniciadaEn" FROM sesion_pilotaje WHERE id = $1`, [id]);
    const incidentes = await tx.query(
      `SELECT ocurrido_en AS "ocurridoEn", resuelto_en AS "resueltoEn", completo_registro AS "completoRegistro" FROM incidente WHERE sesion_id = $1`,
      [id],
    );
    const evaluados = incidentes.rows.map(conEscalamiento);
    const resueltos = evaluados.filter((i) => i.minutosSolucion != null);
    const reporte = {
      operacion: resumenDeOperacion(new Date(rows[0].iniciadaEn).getTime()),
      incidentes: {
        total: evaluados.length,
        resueltos: resueltos.length,
        criticos: evaluados.filter((i) => i.critico).length,
        sinCompletarRegistro: evaluados.filter((i) => !i.completoRegistro).length,
        promedioSolucionMin: resueltos.length ? Math.round(resueltos.reduce((t, i) => t + i.minutosSolucion!, 0) / resueltos.length) : null,
      },
      umbralP95Ms: UMBRAL_P95_MS,
    };
    const estado = datos.suspendida ? 'SUSPENDIDA' : 'FINALIZADA';
    await tx.query(
      `UPDATE sesion_pilotaje SET estado = $2, finalizada_en = now(), causa_cierre = $3, reporte = $4 WHERE id = $1`,
      [id, estado, datos.causa || null, JSON.stringify(reporte)],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: datos.suspendida ? 'SUSPENDER_SESION_PILOTAJE' : 'FINALIZAR_SESION_PILOTAJE',
      entidadAfectada: 'SESION_PILOTAJE',
      registroId: id,
      valoresNuevos: reporte,
      detalle: `Sesión "${sesion.nombre}" ${datos.suspendida ? `suspendida: ${datos.causa}` : 'finalizada'}; reporte de comportamiento técnico generado`,
    });
    return { id, estado, reporte };
  });
}
