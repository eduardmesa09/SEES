import { z } from 'zod';
import { Contexto } from '../../contexto';
import { Ejecutor, enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { MODALIDADES, normalizar, validarCupo, validarRangoDeFechas } from '../../domain/reglas';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';

export interface EstrategiaBase {
  id: number;
  codigo: string;
  nombre: string;
  objetivo: string;
  modalidad: string;
  fechaInicio: string;
  fechaFin: string;
  cupoMaximo: number;
  estado: 'EDITABLE' | 'BLOQUEADA';
  edicionAutorizada: boolean;
  version: number;
  entidadId: number;
  entidadNombre: string;
  municipio: string;
  territorio: string;
  vinculados: number;
}

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');

export const esquemaEstrategia = z.object({
  entidadId: z.number().int().positive(),
  nombre: z.string().trim().min(3).max(150),
  objetivo: z.string().trim().min(10).max(1000),
  modalidad: z.enum(MODALIDADES),
  fechaInicio: fecha,
  fechaFin: fecha,
  cupoMaximo: z.number().int(),
  tutorIds: z.array(z.number().int().positive()).default([]),
  docenteIds: z.array(z.number().int().positive()).min(1),
  confirmarDuplicado: z.boolean().optional(),
});
export type DatosEstrategia = z.infer<typeof esquemaEstrategia>;

export const esquemaModificacion = esquemaEstrategia.omit({ entidadId: true }).extend({
  version: z.number().int().positive(),
});
export type DatosModificacion = z.infer<typeof esquemaModificacion>;

export const esquemaSolicitud = z.object({
  cambiosSolicitados: z.string().trim().min(5).max(1000),
  justificacion: z.string().trim().min(10).max(1000),
});

const SELECT_BASE = `
  SELECT e.id, e.codigo, e.nombre, e.objetivo, e.modalidad,
         e.fecha_inicio AS "fechaInicio", e.fecha_fin AS "fechaFin",
         e.cupo_maximo AS "cupoMaximo", e.estado, e.edicion_autorizada AS "edicionAutorizada", e.version,
         e.creado_en AS "creadoEn", e.actualizado_en AS "actualizadoEn", e.bloqueada_en AS "bloqueadaEn",
         e.entidad_id AS "entidadId", en.nombre AS "entidadNombre", en.municipio, en.territorio,
         (SELECT count(*) FROM vinculacion_estudiante v
           WHERE v.estrategia_id = e.id AND v.estado = 'ACTIVA')::int AS vinculados
    FROM estrategia e
    JOIN entidad en ON en.id = e.entidad_id`;

/**
 * Predicado de ámbito (RQ_002): se incorpora a la consulta antes de ejecutarla, de modo que
 * la restricción no dependa de ocultar opciones en la interfaz.
 * - Tutor: únicamente las estrategias que tiene asignadas.
 * - Tutor líder: las estrategias de las entidades de su territorio.
 * - Ente de control: toda la información, en modo consulta (RN-08).
 * - Administrador y soporte: sin acceso al registro misional.
 */
export function predicadoDeAmbito(ctx: Contexto, params: unknown[], alias = 'e'): string {
  if (ctx.usuario.perfil === 'TUTOR') {
    params.push(ctx.usuario.id);
    return `EXISTS (SELECT 1 FROM estrategia_tutor et WHERE et.estrategia_id = ${alias}.id AND et.usuario_id = $${params.length})`;
  }
  if (ctx.usuario.perfil === 'TUTOR_LIDER') {
    params.push(ctx.usuario.entidades);
    return `${alias}.entidad_id = ANY($${params.length}::int[])`;
  }
  if (ctx.usuario.perfil === 'ENTE_CONTROL') return 'TRUE';
  return 'FALSE';
}

/**
 * Carga una estrategia verificando que esté dentro del ámbito del usuario.
 * Fuera de ámbito responde 403 y deja el intento en la auditoría.
 * Con `bloquear`, toma el bloqueo de fila para serializar las operaciones sobre la estrategia.
 */
export async function exigirEstrategia(
  db: Ejecutor,
  ctx: Contexto,
  estrategiaId: number,
  opciones: { bloquear?: boolean } = {},
): Promise<EstrategiaBase> {
  if (opciones.bloquear) {
    await db.query(`SELECT id FROM estrategia WHERE id = $1 FOR UPDATE`, [estrategiaId]);
  }
  const { rows } = await db.query(`${SELECT_BASE} WHERE e.id = $1`, [estrategiaId]);
  const estrategia = rows[0] as EstrategiaBase | undefined;
  if (!estrategia) throw new AppError(404, 'ESTRATEGIA_NO_ENCONTRADA', 'La estrategia no existe.');

  const params: unknown[] = [estrategiaId];
  const enAmbito = await db.query(
    `SELECT 1 FROM estrategia e WHERE e.id = $1 AND ${predicadoDeAmbito(ctx, params)}`,
    params,
  );
  if (enAmbito.rowCount === 0) {
    await registrarAuditoria(pool, ctx, {
      operacion: 'ACCESO_DENEGADO',
      entidadAfectada: 'ESTRATEGIA',
      registroId: estrategiaId,
      detalle: `Intento de acceso a la estrategia ${estrategia.codigo}, que está fuera del ámbito del usuario`,
    });
    throw new AppError(403, 'FUERA_DE_AMBITO', 'La estrategia está fuera de su ámbito de trabajo.');
  }
  return estrategia;
}

async function tutoresDe(db: Ejecutor, estrategiaId: number) {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.correo FROM estrategia_tutor et JOIN usuario u ON u.id = et.usuario_id
      WHERE et.estrategia_id = $1 ORDER BY u.nombre`,
    [estrategiaId],
  );
  return rows as { id: number; nombre: string; correo: string }[];
}

async function docentesDe(db: Ejecutor, estrategiaId: number) {
  const { rows } = await db.query(
    `SELECT d.id, d.nombre, d.area, d.documento FROM estrategia_docente ed JOIN docente d ON d.id = ed.docente_id
      WHERE ed.estrategia_id = $1 ORDER BY d.nombre`,
    [estrategiaId],
  );
  return rows as { id: number; nombre: string; area: string; documento: string }[];
}

/** Fotografía de los datos estructurales: es lo que se conserva como versión anterior. */
async function instantanea(db: Ejecutor, estrategia: EstrategiaBase) {
  const [tutores, docentes] = await Promise.all([tutoresDe(db, estrategia.id), docentesDe(db, estrategia.id)]);
  return {
    nombre: estrategia.nombre,
    objetivo: estrategia.objetivo,
    modalidad: estrategia.modalidad,
    fechaInicio: estrategia.fechaInicio,
    fechaFin: estrategia.fechaFin,
    cupoMaximo: estrategia.cupoMaximo,
    tutores: tutores.map((t) => t.nombre),
    docentes: docentes.map((d) => d.nombre),
  };
}

/** Valida tutores y docentes contra la entidad y devuelve la lista final de tutores (incluye al creador). */
async function validarComposicion(
  db: Ejecutor,
  ctx: Contexto,
  entidadId: number,
  tutorIds: number[],
  docenteIds: number[],
): Promise<{ tutorIds: number[]; docenteIds: number[] }> {
  const tutores = [...new Set([ctx.usuario.id, ...tutorIds])];
  const habilitados = await db.query(
    `SELECT u.id FROM usuario u
       JOIN ambito_usuario a ON a.usuario_id = u.id AND a.entidad_id = $2
      WHERE u.id = ANY($1::int[]) AND u.perfil = 'TUTOR' AND u.estado = 'ACTIVO'`,
    [tutores, entidadId],
  );
  if (habilitados.rowCount !== tutores.length) {
    throw new AppError(400, 'TUTOR_NO_HABILITADO', 'Alguno de los tutores seleccionados no está habilitado para esa entidad.', {
      campos: { tutorIds: 'Hay tutores no habilitados para la entidad' },
    });
  }

  const docentes = [...new Set(docenteIds)];
  const validos = await db.query(`SELECT id FROM docente WHERE id = ANY($1::int[]) AND entidad_id = $2`, [
    docentes,
    entidadId,
  ]);
  if (validos.rowCount !== docentes.length) {
    throw new AppError(400, 'DOCENTE_NO_PRECARGADO', 'Alguno de los docentes seleccionados no pertenece a la entidad.', {
      campos: { docenteIds: 'Hay docentes que no pertenecen a la entidad' },
    });
  }
  return { tutorIds: tutores, docenteIds: docentes };
}

/** RQ_003: comparación normalizada del nombre dentro de la misma entidad. */
async function buscarHomonima(db: Ejecutor, entidadId: number, nombre: string, exceptoId?: number) {
  const { rows } = await db.query(
    `SELECT e.id, e.codigo, e.nombre, e.estado, e.fecha_inicio AS "fechaInicio", e.fecha_fin AS "fechaFin",
            e.cupo_maximo AS "cupoMaximo",
            (SELECT coalesce(json_agg(u.nombre ORDER BY u.nombre), '[]'::json)
               FROM estrategia_tutor et JOIN usuario u ON u.id = et.usuario_id
              WHERE et.estrategia_id = e.id) AS tutores
       FROM estrategia e
      WHERE e.entidad_id = $1 AND e.nombre_normalizado = $2 AND ($3::int IS NULL OR e.id <> $3)
      ORDER BY e.id LIMIT 1`,
    [entidadId, normalizar(nombre), exceptoId ?? null],
  );
  return rows[0] ?? null;
}

function advertirDuplicidad(existente: unknown): never {
  throw new AppError(
    409,
    'ESTRATEGIA_DUPLICADA',
    'Ya existe una estrategia con el mismo nombre en esa entidad. Confirme que se trata de un grupo distinto o cambie el nombre.',
    { existente },
  );
}

async function reemplazarComposicion(db: Ejecutor, estrategiaId: number, tutorIds: number[], docenteIds: number[]) {
  await db.query(`DELETE FROM estrategia_tutor WHERE estrategia_id = $1`, [estrategiaId]);
  await db.query(`DELETE FROM estrategia_docente WHERE estrategia_id = $1`, [estrategiaId]);
  await db.query(`INSERT INTO estrategia_tutor (estrategia_id, usuario_id) SELECT $1, unnest($2::int[])`, [
    estrategiaId,
    tutorIds,
  ]);
  await db.query(`INSERT INTO estrategia_docente (estrategia_id, docente_id) SELECT $1, unnest($2::int[])`, [
    estrategiaId,
    docenteIds,
  ]);
}

// ---------------------------------------------------------------------------------------
// CU-04: consultar estrategias
// ---------------------------------------------------------------------------------------

export async function listarEstrategias(ctx: Contexto, filtros: { entidadId?: number; estado?: string; q?: string }) {
  const params: unknown[] = [];
  const condiciones = [predicadoDeAmbito(ctx, params)];
  if (filtros.entidadId) {
    params.push(filtros.entidadId);
    condiciones.push(`e.entidad_id = $${params.length}`);
  }
  if (filtros.estado) {
    params.push(filtros.estado);
    condiciones.push(`e.estado = $${params.length}`);
  }
  if (filtros.q) {
    params.push(`%${normalizar(filtros.q)}%`);
    condiciones.push(`(e.nombre_normalizado LIKE $${params.length} OR lower(e.codigo) LIKE $${params.length})`);
  }

  const { rows } = await pool.query(
    `SELECT base.*,
            (SELECT coalesce(json_agg(json_build_object('id', u.id, 'nombre', u.nombre) ORDER BY u.nombre), '[]'::json)
               FROM estrategia_tutor et JOIN usuario u ON u.id = et.usuario_id
              WHERE et.estrategia_id = base.id) AS tutores,
            (SELECT count(*) FROM estrategia_docente ed WHERE ed.estrategia_id = base.id)::int AS docentes,
            (SELECT count(*) FROM solicitud_modificacion s
              WHERE s.estrategia_id = base.id AND s.estado = 'RADICADA')::int AS "solicitudesPendientes"
       FROM (${SELECT_BASE} WHERE ${condiciones.join(' AND ')}) base
      ORDER BY base."creadoEn" DESC`,
    params,
  );
  return rows;
}

export async function detalleEstrategia(ctx: Contexto, estrategiaId: number) {
  const estrategia = await exigirEstrategia(pool, ctx, estrategiaId);
  const [tutores, docentes, solicitudes, versiones] = await Promise.all([
    tutoresDe(pool, estrategiaId),
    docentesDe(pool, estrategiaId),
    pool.query(
      `SELECT s.id, s.cambios_solicitados AS "cambiosSolicitados", s.justificacion, s.estado,
              s.creado_en AS "creadoEn", u.nombre AS "solicitadoPor", s.respuesta,
              s.resuelto_en AS "resueltoEn", r.nombre AS "resueltoPor"
         FROM solicitud_modificacion s JOIN usuario u ON u.id = s.solicitado_por
         LEFT JOIN usuario r ON r.id = s.resuelto_por
        WHERE s.estrategia_id = $1 ORDER BY s.id DESC`,
      [estrategiaId],
    ),
    pool.query(
      `SELECT v.id, v.version, v.datos, v.modificado_en AS "modificadoEn", u.nombre AS "modificadoPor"
         FROM estrategia_version v JOIN usuario u ON u.id = v.modificado_por
        WHERE v.estrategia_id = $1 ORDER BY v.version DESC`,
      [estrategiaId],
    ),
  ]);

  const esTutorAsignado = ctx.usuario.perfil === 'TUTOR' && tutores.some((t) => t.id === ctx.usuario.id);
  return {
    ...estrategia,
    cupoDisponible: estrategia.cupoMaximo - estrategia.vinculados,
    tutores,
    docentes,
    solicitudes: solicitudes.rows,
    versiones: versiones.rows,
    permisos: {
      editar: esTutorAsignado && (estrategia.estado === 'EDITABLE' || estrategia.edicionAutorizada),
      vincular: esTutorAsignado,
      desvincular: esTutorAsignado,
      solicitarModificacion:
        esTutorAsignado && estrategia.estado === 'BLOQUEADA' && !estrategia.edicionAutorizada &&
        !solicitudes.rows.some((s) => s.estado === 'RADICADA'),
    },
    motivoBloqueo:
      estrategia.estado === 'BLOQUEADA'
        ? estrategia.edicionAutorizada
          ? 'El tutor líder aprobó la solicitud de modificación: puede editar la estrategia una vez. Al guardar, vuelve a quedar bloqueada.'
          : `La estrategia tiene ${estrategia.vinculados} estudiante(s) vinculado(s): sus datos estructurales ya no pueden editarse. Cualquier ajuste requiere una solicitud de modificación.`
        : null,
  };
}

// ---------------------------------------------------------------------------------------
// CU-02: crear estrategia estudiantil (RQ_003)
// ---------------------------------------------------------------------------------------

export async function crearEstrategia(ctx: Contexto, datos: DatosEstrategia) {
  if (!ctx.usuario.entidades.includes(datos.entidadId)) {
    await registrarAuditoria(pool, ctx, {
      operacion: 'ACCESO_DENEGADO',
      entidadAfectada: 'ENTIDAD',
      registroId: datos.entidadId,
      detalle: 'Intento de crear una estrategia en una entidad fuera del ámbito del usuario',
    });
    throw new AppError(
      403,
      'ENTIDAD_FUERA_DE_AMBITO',
      'La entidad está por fuera de su ámbito. Solicite la ampliación de su ámbito al administrador.',
    );
  }
  validarRangoDeFechas(datos.fechaInicio, datos.fechaFin);
  validarCupo(datos.cupoMaximo);

  return enTransaccion(async (tx) => {
    // La entidad se toma exclusivamente del catálogo precargado (llave foránea a ENTIDAD).
    const entidad = await tx.query(`SELECT id, nombre FROM entidad WHERE id = $1`, [datos.entidadId]);
    if (entidad.rowCount === 0) throw new AppError(400, 'ENTIDAD_INEXISTENTE', 'La entidad seleccionada no existe.');

    const composicion = await validarComposicion(tx, ctx, datos.entidadId, datos.tutorIds, datos.docenteIds);

    const homonima = await buscarHomonima(tx, datos.entidadId, datos.nombre);
    if (homonima && !datos.confirmarDuplicado) advertirDuplicidad(homonima);

    const insercion = await tx.query(
      `INSERT INTO estrategia
         (codigo, entidad_id, nombre, nombre_normalizado, objetivo, modalidad, fecha_inicio, fecha_fin, cupo_maximo, creado_por)
       VALUES ('EST-' || lpad(nextval('estrategia_consecutivo_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        datos.entidadId,
        datos.nombre,
        normalizar(datos.nombre),
        datos.objetivo,
        datos.modalidad,
        datos.fechaInicio,
        datos.fechaFin,
        datos.cupoMaximo,
        ctx.usuario.id,
      ],
    );
    const id = insercion.rows[0].id as number;
    await reemplazarComposicion(tx, id, composicion.tutorIds, composicion.docenteIds);

    const creada = await exigirEstrategia(tx, ctx, id);
    await registrarAuditoria(tx, ctx, {
      operacion: 'CREAR_ESTRATEGIA',
      entidadAfectada: 'ESTRATEGIA',
      registroId: id,
      valoresNuevos: { codigo: creada.codigo, entidad: creada.entidadNombre, ...(await instantanea(tx, creada)) },
      detalle: homonima
        ? `Estrategia ${creada.codigo} creada. Advertencia de duplicidad atendida: el usuario confirmó que es un grupo distinto de ${homonima.codigo}`
        : `Estrategia ${creada.codigo} creada en estado EDITABLE`,
    });
    return creada;
  });
}

// ---------------------------------------------------------------------------------------
// CU-03: modificar estrategia (RQ_004)
// ---------------------------------------------------------------------------------------

export async function modificarEstrategia(ctx: Contexto, estrategiaId: number, datos: DatosModificacion) {
  return enTransaccion(async (tx) => {
    const actual = await exigirEstrategia(tx, ctx, estrategiaId, { bloquear: true });

    // RQ_004: el rechazo ocurre en el servidor, aunque la petición llegue directa y no desde la interfaz.
    if (actual.estado === 'BLOQUEADA' && !actual.edicionAutorizada) {
      await registrarAuditoria(pool, ctx, {
        operacion: 'EDICION_RECHAZADA',
        entidadAfectada: 'ESTRATEGIA',
        registroId: estrategiaId,
        detalle: `Intento de modificar la estrategia ${actual.codigo}, bloqueada por tener ${actual.vinculados} estudiante(s) vinculado(s)`,
      });
      throw new AppError(
        403,
        'ESTRATEGIA_BLOQUEADA',
        `La estrategia tiene ${actual.vinculados} estudiante(s) vinculado(s) y ya no puede editarse. Radique una solicitud de modificación con su justificación.`,
        { vinculados: actual.vinculados },
      );
    }

    if (actual.estado === 'BLOQUEADA' && datos.cupoMaximo < actual.vinculados) {
      throw new AppError(
        400,
        'CUPO_MENOR_A_VINCULADOS',
        `El cupo no puede ser menor que los ${actual.vinculados} estudiante(s) ya vinculados.`,
        { campos: { cupoMaximo: `Mínimo ${actual.vinculados}` } },
      );
    }

    if (actual.version !== datos.version) {
      throw new AppError(
        409,
        'CONFLICTO_DE_VERSION',
        'Otro usuario modificó la estrategia mientras usted la editaba. Revise la información actualizada antes de guardar.',
        { versionActual: actual.version },
      );
    }

    validarRangoDeFechas(datos.fechaInicio, datos.fechaFin);
    validarCupo(datos.cupoMaximo);
    const composicion = await validarComposicion(tx, ctx, actual.entidadId, datos.tutorIds, datos.docenteIds);

    const homonima = await buscarHomonima(tx, actual.entidadId, datos.nombre, estrategiaId);
    if (homonima && !datos.confirmarDuplicado) advertirDuplicidad(homonima);

    const anterior = await instantanea(tx, actual);
    await tx.query(
      `INSERT INTO estrategia_version (estrategia_id, version, datos, modificado_por) VALUES ($1, $2, $3, $4)`,
      [estrategiaId, actual.version, JSON.stringify(anterior), ctx.usuario.id],
    );
    await tx.query(
      `UPDATE estrategia
          SET nombre = $2, nombre_normalizado = $3, objetivo = $4, modalidad = $5,
              fecha_inicio = $6, fecha_fin = $7, cupo_maximo = $8,
              version = version + 1, actualizado_en = now(), edicion_autorizada = FALSE
        WHERE id = $1`,
      [
        estrategiaId,
        datos.nombre,
        normalizar(datos.nombre),
        datos.objetivo,
        datos.modalidad,
        datos.fechaInicio,
        datos.fechaFin,
        datos.cupoMaximo,
      ],
    );
    await reemplazarComposicion(tx, estrategiaId, composicion.tutorIds, composicion.docenteIds);

    if (actual.edicionAutorizada) {
      await tx.query(
        `UPDATE solicitud_modificacion SET estado = 'APLICADA' WHERE estrategia_id = $1 AND estado = 'APROBADA'`,
        [estrategiaId],
      );
    }

    const nueva = await exigirEstrategia(tx, ctx, estrategiaId);
    await registrarAuditoria(tx, ctx, {
      operacion: 'MODIFICAR_ESTRATEGIA',
      entidadAfectada: 'ESTRATEGIA',
      registroId: estrategiaId,
      valoresPrevios: anterior,
      valoresNuevos: await instantanea(tx, nueva),
      detalle: actual.edicionAutorizada
        ? `Estrategia ${nueva.codigo} modificada con la autorización del tutor líder: versión ${actual.version} conservada`
        : `Estrategia ${nueva.codigo} modificada: versión ${actual.version} conservada`,
    });
    return nueva;
  });
}

/** CU-03, flujo alterno: la solicitud queda radicada sin alterar la estrategia. */
export async function radicarSolicitud(ctx: Contexto, estrategiaId: number, datos: z.infer<typeof esquemaSolicitud>) {
  return enTransaccion(async (tx) => {
    const estrategia = await exigirEstrategia(tx, ctx, estrategiaId);
    if (estrategia.estado !== 'BLOQUEADA') {
      throw new AppError(409, 'ESTRATEGIA_EDITABLE', 'La estrategia aún es editable: puede modificarla directamente.');
    }
    const pendiente = await tx.query(
      `SELECT 1 FROM solicitud_modificacion WHERE estrategia_id = $1 AND estado IN ('RADICADA', 'APROBADA')`,
      [estrategiaId],
    );
    if (pendiente.rowCount) {
      throw new AppError(409, 'SOLICITUD_PENDIENTE', 'Ya hay una solicitud de modificación en trámite para esta estrategia.');
    }
    const { rows } = await tx.query(
      `INSERT INTO solicitud_modificacion (estrategia_id, solicitado_por, cambios_solicitados, justificacion)
       VALUES ($1, $2, $3, $4)
       RETURNING id, estado, creado_en AS "creadoEn"`,
      [estrategiaId, ctx.usuario.id, datos.cambiosSolicitados, datos.justificacion],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'RADICAR_SOLICITUD_MODIFICACION',
      entidadAfectada: 'ESTRATEGIA',
      registroId: estrategiaId,
      valoresNuevos: datos,
      detalle: `Solicitud de modificación radicada sobre ${estrategia.codigo}; la estrategia no se altera`,
    });
    return { ...rows[0], ...datos };
  });
}

/**
 * RQ_004: bloqueo de la estrategia. Lo invoca el módulo de Vinculación dentro de la misma
 * transacción en que registra la primera vinculación; la responsabilidad sobre el estado
 * queda en un solo lugar, que es este módulo.
 */
export async function bloquearPorPrimeraVinculacion(tx: Ejecutor, ctx: Contexto, estrategia: EstrategiaBase) {
  const { rowCount } = await tx.query(
    `UPDATE estrategia SET estado = 'BLOQUEADA', bloqueada_en = now(), actualizado_en = now()
      WHERE id = $1 AND estado = 'EDITABLE'`,
    [estrategia.id],
  );
  if (rowCount === 0) return false;
  await registrarAuditoria(tx, ctx, {
    operacion: 'BLOQUEAR_ESTRATEGIA',
    entidadAfectada: 'ESTRATEGIA',
    registroId: estrategia.id,
    valoresPrevios: { estado: 'EDITABLE' },
    valoresNuevos: { estado: 'BLOQUEADA' },
    detalle: `Estrategia ${estrategia.codigo} bloqueada para edición al recibir su primera vinculación`,
  });
  return true;
}

/**
 * CU-06: si al desvincular un estudiante la estrategia queda sin participantes activos, la condición
 * que la bloqueaba desapareció y vuelve a ser editable. Igual que el bloqueo, lo ejecuta este módulo.
 */
export async function desbloquearSinVinculados(tx: Ejecutor, ctx: Contexto, estrategia: EstrategiaBase) {
  const activos = await tx.query(
    `SELECT count(*)::int AS n FROM vinculacion_estudiante WHERE estrategia_id = $1 AND estado = 'ACTIVA'`,
    [estrategia.id],
  );
  if (activos.rows[0].n > 0) return false;
  const { rowCount } = await tx.query(
    `UPDATE estrategia SET estado = 'EDITABLE', bloqueada_en = NULL, edicion_autorizada = FALSE, actualizado_en = now()
      WHERE id = $1 AND estado = 'BLOQUEADA'`,
    [estrategia.id],
  );
  if (rowCount === 0) return false;
  await registrarAuditoria(tx, ctx, {
    operacion: 'DESBLOQUEAR_ESTRATEGIA',
    entidadAfectada: 'ESTRATEGIA',
    registroId: estrategia.id,
    valoresPrevios: { estado: 'BLOQUEADA' },
    valoresNuevos: { estado: 'EDITABLE' },
    detalle: `Estrategia ${estrategia.codigo} vuelve a ser editable: quedó sin estudiantes activos`,
  });
  return true;
}

// ---------------------------------------------------------------------------------------
// Decisión de las solicitudes de modificación (tutor líder)
// ---------------------------------------------------------------------------------------

export const esquemaDecision = z.object({
  aprobar: z.boolean(),
  respuesta: z.string().trim().min(5).max(1000),
});

export async function listarSolicitudesModificacion(ctx: Contexto) {
  const params: unknown[] = [];
  const { rows } = await pool.query(
    `SELECT s.id, s.estrategia_id AS "estrategiaId", e.codigo, e.nombre AS "estrategiaNombre", en.nombre AS "entidadNombre",
            s.cambios_solicitados AS "cambiosSolicitados", s.justificacion, s.estado, s.creado_en AS "creadoEn",
            u.nombre AS "solicitadoPor", s.respuesta, s.resuelto_en AS "resueltoEn", r.nombre AS "resueltoPor"
       FROM solicitud_modificacion s
       JOIN estrategia e ON e.id = s.estrategia_id
       JOIN entidad en ON en.id = e.entidad_id
       JOIN usuario u ON u.id = s.solicitado_por
       LEFT JOIN usuario r ON r.id = s.resuelto_por
      WHERE ${predicadoDeAmbito(ctx, params)}
      ORDER BY (s.estado = 'RADICADA') DESC, s.id DESC`,
    params,
  );
  return rows;
}

/** Aprobada, la estrategia admite una única edición; rechazada, sigue bloqueada. */
export async function resolverSolicitudModificacion(ctx: Contexto, solicitudId: number, datos: z.infer<typeof esquemaDecision>) {
  return enTransaccion(async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, estrategia_id AS "estrategiaId", estado FROM solicitud_modificacion WHERE id = $1 FOR UPDATE`,
      [solicitudId],
    );
    const solicitud = rows[0];
    if (!solicitud) throw new AppError(404, 'SOLICITUD_NO_ENCONTRADA', 'La solicitud no existe.');
    const estrategia = await exigirEstrategia(tx, ctx, solicitud.estrategiaId, { bloquear: true });
    if (solicitud.estado !== 'RADICADA') {
      throw new AppError(409, 'SOLICITUD_RESUELTA', 'La solicitud ya fue resuelta.');
    }
    const estado = datos.aprobar ? 'APROBADA' : 'RECHAZADA';
    await tx.query(
      `UPDATE solicitud_modificacion SET estado = $2, respuesta = $3, resuelto_por = $4, resuelto_en = now() WHERE id = $1`,
      [solicitudId, estado, datos.respuesta, ctx.usuario.id],
    );
    if (datos.aprobar) {
      await tx.query(`UPDATE estrategia SET edicion_autorizada = TRUE WHERE id = $1`, [estrategia.id]);
    }
    await registrarAuditoria(tx, ctx, {
      operacion: datos.aprobar ? 'APROBAR_SOLICITUD_MODIFICACION' : 'RECHAZAR_SOLICITUD_MODIFICACION',
      entidadAfectada: 'ESTRATEGIA',
      registroId: estrategia.id,
      valoresPrevios: { estado: 'RADICADA' },
      valoresNuevos: { estado, respuesta: datos.respuesta },
      detalle: datos.aprobar
        ? `Solicitud de modificación sobre ${estrategia.codigo} aprobada: se habilita una edición`
        : `Solicitud de modificación sobre ${estrategia.codigo} rechazada`,
    });
    return { id: solicitudId, estado };
  });
}
