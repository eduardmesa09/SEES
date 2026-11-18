import { Contexto } from '../../contexto';
import { Ejecutor, enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { MOTIVOS_DESVINCULACION, hoy, normalizar } from '../../domain/reglas';
import { esFechaValida } from '../../domain/semanas';
import { z } from 'zod';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';
import { bloquearPorPrimeraVinculacion, desbloquearSinVinculados, exigirEstrategia } from '../estrategias/estrategias.servicio';

export interface DocenteDeEstrategia {
  id: number;
  nombre: string;
  area: string;
  documento: string;
}

/**
 * Población de docentes habilitada para una estrategia.
 * El módulo de Acompañamiento no consulta esta relación por su cuenta: la pide aquí, de modo que
 * la regla "solo se acompaña a los docentes de la estrategia" (RN-04) viva en un solo lugar.
 */
export async function docentesDeEstrategia(db: Ejecutor, estrategiaId: number): Promise<DocenteDeEstrategia[]> {
  const { rows } = await db.query(
    `SELECT d.id, d.nombre, d.area, d.documento
       FROM estrategia_docente ed JOIN docente d ON d.id = ed.docente_id
      WHERE ed.estrategia_id = $1
      ORDER BY d.nombre`,
    [estrategiaId],
  );
  return rows;
}

/** CU-05: búsqueda de estudiantes precargados por documento, nombre o grado, dentro de la entidad. */
export async function buscarCandidatos(
  ctx: Contexto,
  estrategiaId: number,
  filtros: { q?: string; grado?: string; pagina: number; tamano: number },
) {
  const estrategia = await exigirEstrategia(pool, ctx, estrategiaId);

  const params: unknown[] = [estrategia.entidadId];
  const condiciones = ['s.entidad_id = $1'];
  if (filtros.q) {
    params.push(`${filtros.q.trim()}%`);
    const porDocumento = `s.documento LIKE $${params.length}`;
    params.push(`%${normalizar(filtros.q)}%`);
    condiciones.push(`(${porDocumento} OR s.nombre_busqueda LIKE $${params.length})`);
  }
  if (filtros.grado) {
    params.push(filtros.grado);
    condiciones.push(`s.grado = $${params.length}`);
  }
  const where = condiciones.join(' AND ');

  const [total, precargados, grados, filas] = await Promise.all([
    pool.query(`SELECT count(*) AS total FROM estudiante s WHERE ${where}`, params),
    pool.query(`SELECT count(*) AS total FROM estudiante WHERE entidad_id = $1`, [estrategia.entidadId]),
    pool.query(`SELECT grado FROM estudiante WHERE entidad_id = $1 GROUP BY grado ORDER BY length(grado), grado`, [
      estrategia.entidadId,
    ]),
    pool.query(
      `SELECT s.id, s.tipo_documento AS "tipoDocumento", s.documento, s.nombres, s.apellidos, s.grado,
              EXISTS (SELECT 1 FROM vinculacion_estudiante v
                       WHERE v.estrategia_id = $${params.length + 1} AND v.estudiante_id = s.id AND v.estado = 'ACTIVA') AS "yaVinculado"
         FROM estudiante s
        WHERE ${where}
        ORDER BY length(s.grado), s.grado, s.apellidos, s.nombres
        LIMIT $${params.length + 2} OFFSET $${params.length + 3}`,
      [...params, estrategiaId, filtros.tamano, (filtros.pagina - 1) * filtros.tamano],
    ),
  ]);

  return {
    estrategia: {
      id: estrategia.id,
      codigo: estrategia.codigo,
      nombre: estrategia.nombre,
      estado: estrategia.estado,
      entidadNombre: estrategia.entidadNombre,
      cupoMaximo: estrategia.cupoMaximo,
      vinculados: estrategia.vinculados,
      cupoDisponible: estrategia.cupoMaximo - estrategia.vinculados,
      vencida: estrategia.fechaFin < hoy(),
    },
    // Si la entidad aún no tiene carga, se informa de forma explícita en lugar de devolver una búsqueda vacía.
    cargaPendiente: precargados.rows[0].total === 0,
    grados: grados.rows.map((g) => g.grado as string),
    total: total.rows[0].total as number,
    pagina: filtros.pagina,
    tamano: filtros.tamano,
    estudiantes: filas.rows,
  };
}

export async function listarVinculados(ctx: Contexto, estrategiaId: number) {
  await exigirEstrategia(pool, ctx, estrategiaId);
  const { rows } = await pool.query(
    `SELECT v.id, v.estado, v.fecha_vinculacion AS "fechaVinculacion", u.nombre AS "vinculadoPor",
            v.fecha_desvinculacion AS "fechaDesvinculacion", v.motivo_desvinculacion AS "motivoDesvinculacion",
            s.id AS "estudianteId", s.tipo_documento AS "tipoDocumento", s.documento, s.nombres, s.apellidos, s.grado
       FROM vinculacion_estudiante v
       JOIN estudiante s ON s.id = v.estudiante_id
       JOIN usuario u ON u.id = v.vinculado_por
      WHERE v.estrategia_id = $1
      ORDER BY v.estado, length(s.grado), s.grado, s.apellidos, s.nombres`,
    [estrategiaId],
  );
  return rows;
}

/**
 * CU-05 / RQ_005: vincula estudiantes precargados en una única transacción.
 * Con la primera vinculación la estrategia pasa a BLOQUEADA dentro de esa misma transacción (RQ_004).
 * El Piloto no crea estudiantes: solo vincula registros que ya existen.
 */
export async function vincularEstudiantes(ctx: Contexto, estrategiaId: number, estudianteIds: number[]) {
  const ids = [...new Set(estudianteIds)];

  return enTransaccion(async (tx) => {
    const estrategia = await exigirEstrategia(tx, ctx, estrategiaId, { bloquear: true });

    if (estrategia.fechaFin < hoy()) {
      throw new AppError(
        409,
        'ESTRATEGIA_VENCIDA',
        `La estrategia finalizó el ${estrategia.fechaFin}: no admite nuevas vinculaciones.`,
      );
    }

    const { rows: estudiantes } = await tx.query(
      `SELECT id, documento, nombres, apellidos, grado, entidad_id AS "entidadId"
         FROM estudiante WHERE id = ANY($1::int[])`,
      [ids],
    );
    if (estudiantes.length !== ids.length) {
      throw new AppError(
        404,
        'ESTUDIANTE_NO_PRECARGADO',
        'Alguno de los estudiantes no existe en la información precargada. El Piloto no permite crear estudiantes nuevos: solicite la carga al administrador.',
      );
    }
    if (estudiantes.some((e) => e.entidadId !== estrategia.entidadId)) {
      throw new AppError(
        400,
        'ESTUDIANTE_DE_OTRA_ENTIDAD',
        'Alguno de los estudiantes seleccionados no pertenece a la entidad de la estrategia.',
      );
    }

    // Los que ya están vinculados se descartan sin interrumpir el resto del lote.
    const existentes = await tx.query(
      `SELECT estudiante_id, estado FROM vinculacion_estudiante WHERE estrategia_id = $1 AND estudiante_id = ANY($2::int[])`,
      [estrategiaId, ids],
    );
    const yaVinculados = new Set(existentes.rows.filter((r) => r.estado === 'ACTIVA').map((r) => r.estudiante_id as number));
    const aReactivar = new Set(existentes.rows.filter((r) => r.estado === 'INACTIVA').map((r) => r.estudiante_id as number));
    const descartados = estudiantes.filter((e) => yaVinculados.has(e.id));
    const nuevos = estudiantes.filter((e) => !yaVinculados.has(e.id));

    const cuposDisponibles = estrategia.cupoMaximo - estrategia.vinculados;
    if (nuevos.length > cuposDisponibles) {
      throw new AppError(
        409,
        'CUPO_EXCEDIDO',
        `La selección supera el cupo: quedan ${cuposDisponibles} cupo(s) disponible(s) y seleccionó ${nuevos.length}. Ajuste la selección o tramite una modificación del cupo.`,
        { cuposDisponibles, seleccionados: nuevos.length, cupoMaximo: estrategia.cupoMaximo },
      );
    }

    let bloqueoAplicado = false;
    if (nuevos.length > 0) {
      // Quien había sido desvinculado vuelve a quedar activo; su retiro anterior queda en la auditoría.
      await tx.query(
        `UPDATE vinculacion_estudiante
            SET estado = 'ACTIVA', fecha_vinculacion = $3, vinculado_por = $4, fecha_desvinculacion = NULL,
                motivo_desvinculacion = NULL, desvinculado_por = NULL, desvinculado_en = NULL
          WHERE estrategia_id = $1 AND estudiante_id = ANY($2::int[])`,
        [estrategiaId, [...aReactivar], hoy(), ctx.usuario.id],
      );
      await tx.query(
        `INSERT INTO vinculacion_estudiante (estrategia_id, estudiante_id, fecha_vinculacion, vinculado_por)
         SELECT $1, unnest($2::int[]), $3, $4`,
        [estrategiaId, nuevos.filter((e) => !aReactivar.has(e.id)).map((e) => e.id), hoy(), ctx.usuario.id],
      );

      // Vinculación informa que llegó la primera vinculación; es Estrategias quien ejecuta el bloqueo.
      if (estrategia.estado === 'EDITABLE') {
        bloqueoAplicado = await bloquearPorPrimeraVinculacion(tx, ctx, estrategia);
      }

      await registrarAuditoria(tx, ctx, {
        operacion: 'VINCULAR_ESTUDIANTES',
        entidadAfectada: 'ESTRATEGIA',
        registroId: estrategiaId,
        valoresPrevios: { vinculados: estrategia.vinculados },
        valoresNuevos: {
          vinculados: estrategia.vinculados + nuevos.length,
          estudiantes: nuevos.map((e) => e.documento),
          descartadosPorDuplicidad: descartados.map((e) => e.documento),
        },
        detalle: `${nuevos.length} estudiante(s) vinculado(s) a ${estrategia.codigo}; ${descartados.length} descartado(s) por estar ya vinculados`,
      });
    }

    const resumen = (e: { id: number; documento: string; nombres: string; apellidos: string; grado: string }) => ({
      id: e.id,
      documento: e.documento,
      nombre: `${e.nombres} ${e.apellidos}`,
      grado: e.grado,
    });
    const totalVinculados = estrategia.vinculados + nuevos.length;
    return {
      vinculados: nuevos.map(resumen),
      descartados: descartados.map(resumen),
      totalVinculados,
      cupoMaximo: estrategia.cupoMaximo,
      cupoDisponible: estrategia.cupoMaximo - totalVinculados,
      estadoAnterior: estrategia.estado,
      estadoEstrategia: bloqueoAplicado ? 'BLOQUEADA' : estrategia.estado,
      bloqueoAplicado,
      fechaVinculacion: hoy(),
    };
  });
}

export const esquemaDesvinculacion = z.object({
  motivo: z.enum(MOTIVOS_DESVINCULACION, { errorMap: () => ({ message: 'Seleccione un motivo de la lista' }) }),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
});

/**
 * CU-06 / RQ_006: desvinculación lógica. El estudiante queda inactivo desde la fecha indicada,
 * se libera el cupo y su participación previa se conserva (RN-07: nada se elimina físicamente).
 */
export async function desvincularEstudiante(
  ctx: Contexto,
  estrategiaId: number,
  vinculacionId: number,
  datos: z.infer<typeof esquemaDesvinculacion>,
) {
  return enTransaccion(async (tx) => {
    const estrategia = await exigirEstrategia(tx, ctx, estrategiaId, { bloquear: true });
    const { rows } = await tx.query(
      `SELECT v.id, v.estado, v.fecha_vinculacion AS "fechaVinculacion", s.documento, s.nombres, s.apellidos
         FROM vinculacion_estudiante v JOIN estudiante s ON s.id = v.estudiante_id
        WHERE v.id = $1 AND v.estrategia_id = $2 FOR UPDATE OF v`,
      [vinculacionId, estrategiaId],
    );
    const vinculacion = rows[0];
    if (!vinculacion) throw new AppError(404, 'VINCULACION_NO_ENCONTRADA', 'El estudiante no está vinculado a esta estrategia.');
    if (vinculacion.estado !== 'ACTIVA') {
      throw new AppError(409, 'YA_DESVINCULADO', 'El estudiante ya fue desvinculado de esta estrategia.');
    }
    if (!esFechaValida(datos.fecha)) {
      throw new AppError(400, 'FECHA_INVALIDA', 'La fecha de desvinculación no es válida.', { campos: { fecha: 'Fecha inválida' } });
    }
    if (datos.fecha < vinculacion.fechaVinculacion) {
      throw new AppError(
        400,
        'FECHA_ANTERIOR_A_VINCULACION',
        `La fecha de desvinculación no puede ser anterior a la vinculación del estudiante, que fue el ${vinculacion.fechaVinculacion}.`,
        { campos: { fecha: `Desde el ${vinculacion.fechaVinculacion}` }, fechaVinculacion: vinculacion.fechaVinculacion },
      );
    }
    if (datos.fecha > hoy()) {
      throw new AppError(400, 'FECHA_FUTURA', 'No puede registrarse una desvinculación que todavía no ha ocurrido.', {
        campos: { fecha: 'No puede ser una fecha futura' },
      });
    }

    await tx.query(
      `UPDATE vinculacion_estudiante
          SET estado = 'INACTIVA', fecha_desvinculacion = $2, motivo_desvinculacion = $3,
              desvinculado_por = $4, desvinculado_en = now()
        WHERE id = $1`,
      [vinculacionId, datos.fecha, datos.motivo, ctx.usuario.id],
    );
    const nombre = `${vinculacion.nombres} ${vinculacion.apellidos}`;
    await registrarAuditoria(tx, ctx, {
      operacion: 'DESVINCULAR_ESTUDIANTE',
      entidadAfectada: 'ESTRATEGIA',
      registroId: estrategiaId,
      valoresPrevios: { estado: 'ACTIVA', vinculados: estrategia.vinculados },
      valoresNuevos: { estado: 'INACTIVA', estudiante: vinculacion.documento, motivo: datos.motivo, desde: datos.fecha, vinculados: estrategia.vinculados - 1 },
      detalle: `${nombre} desvinculado de ${estrategia.codigo} desde el ${datos.fecha}: ${datos.motivo}`,
    });

    const desbloqueada = await desbloquearSinVinculados(tx, ctx, estrategia);
    return {
      estudiante: nombre,
      fecha: datos.fecha,
      motivo: datos.motivo,
      vinculados: estrategia.vinculados - 1,
      cupoDisponible: estrategia.cupoMaximo - estrategia.vinculados + 1,
      estadoEstrategia: desbloqueada ? 'EDITABLE' : estrategia.estado,
      desbloqueada,
    };
  });
}
