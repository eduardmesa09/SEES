import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { Contexto } from '../../contexto';
import { Ejecutor, enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { hoy } from '../../domain/reglas';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';

/**
 * CU-14 / RQ_015: ciclo de vida de los usuarios del Piloto.
 * El administrador gestiona perfiles y ámbitos, pero no tiene acceso al registro misional.
 */

const PERFILES = ['TUTOR', 'TUTOR_LIDER', 'ENTE_CONTROL', 'ADMIN', 'SOPORTE'] as const;
/** Solo estos perfiles trabajan sobre un ámbito de entidades. */
const PERFILES_CON_AMBITO = ['TUTOR', 'TUTOR_LIDER'];

export const esquemaUsuario = z.object({
  documento: z.string().trim().regex(/^\d{5,12}$/, 'Solo números, entre 5 y 12 dígitos'),
  nombre: z.string().trim().min(5).max(120),
  correo: z.string().trim().toLowerCase().email('Correo inválido'),
  perfil: z.enum(PERFILES),
  entidadIds: z.array(z.number().int().positive()).default([]),
});

export const esquemaActualizacion = esquemaUsuario.omit({ documento: true, correo: true });

export const esquemaRevocacion = z.object({
  motivo: z.string().trim().min(5).max(500),
  reasignaciones: z
    .array(z.object({ estrategiaId: z.number().int().positive(), tutorId: z.number().int().positive() }))
    .default([]),
});

/** Credenciales de activación: el usuario debe cambiarlas en su primer ingreso (CU-01). */
function contrasenaTemporal(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  let cuerpo = '';
  for (let i = 0; i < 6; i++) cuerpo += letras[randomInt(letras.length)];
  return `Act-${cuerpo}${randomInt(10, 99)}*`;
}

export async function listarUsuarios() {
  const { rows } = await pool.query(
    `SELECT u.id, u.documento, u.nombre, u.correo, u.perfil, u.estado, u.motivo_estado AS "motivoEstado",
            u.intentos_fallidos AS "intentosFallidos", u.ultimo_acceso AS "ultimoAcceso",
            u.debe_cambiar_contrasena AS "pendienteActivacion",
            (SELECT coalesce(json_agg(e.nombre ORDER BY e.nombre), '[]'::json)
               FROM ambito_usuario a JOIN entidad e ON e.id = a.entidad_id
              WHERE a.usuario_id = u.id) AS ambito,
            (SELECT coalesce(json_agg(a.entidad_id ORDER BY a.entidad_id), '[]'::json)
               FROM ambito_usuario a WHERE a.usuario_id = u.id) AS "entidadIds",
            (SELECT count(*) FROM estrategia_tutor et JOIN estrategia e ON e.id = et.estrategia_id
              WHERE et.usuario_id = u.id AND e.fecha_fin >= $1)::int AS "estrategiasACargo"
       FROM usuario u
      ORDER BY u.perfil, u.nombre`,
    [hoy()],
  );
  return rows;
}

async function exigirUsuario(db: Ejecutor, id: number, bloquear = false) {
  const { rows } = await db.query(
    `SELECT id, documento, nombre, correo, perfil, estado FROM usuario WHERE id = $1 ${bloquear ? 'FOR UPDATE' : ''}`,
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'El usuario no existe.');
  return rows[0] as { id: number; documento: string; nombre: string; correo: string; perfil: string; estado: string };
}

async function validarAmbito(db: Ejecutor, perfil: string, entidadIds: number[]): Promise<number[]> {
  const ids = [...new Set(entidadIds)];
  if (!PERFILES_CON_AMBITO.includes(perfil)) return [];
  if (!ids.length) {
    throw new AppError(400, 'AMBITO_REQUERIDO', 'Los perfiles Tutor y Tutor líder requieren al menos una entidad en su ámbito.', {
      campos: { entidadIds: 'Seleccione al menos una entidad' },
    });
  }
  const { rowCount } = await db.query(`SELECT 1 FROM entidad WHERE id = ANY($1::int[])`, [ids]);
  if (rowCount !== ids.length) throw new AppError(400, 'ENTIDAD_INEXISTENTE', 'Alguna de las entidades del ámbito no existe.');
  return ids;
}

async function reemplazarAmbito(db: Ejecutor, usuarioId: number, entidadIds: number[]) {
  await db.query(`DELETE FROM ambito_usuario WHERE usuario_id = $1`, [usuarioId]);
  if (entidadIds.length) {
    await db.query(`INSERT INTO ambito_usuario (usuario_id, entidad_id) SELECT $1, unnest($2::int[])`, [usuarioId, entidadIds]);
  }
}

/** Alta de usuario con credenciales de activación. Si el documento ya existe, se informa en lugar de duplicarlo. */
export async function crearUsuario(ctx: Contexto, datos: z.infer<typeof esquemaUsuario>) {
  return enTransaccion(async (tx) => {
    const existente = await tx.query(
      `SELECT id, nombre, correo, perfil, estado FROM usuario WHERE documento = $1 OR lower(correo) = $2`,
      [datos.documento, datos.correo],
    );
    if (existente.rows[0]) {
      throw new AppError(
        409,
        'USUARIO_EXISTENTE',
        `Ya existe un usuario con ese documento o correo (${existente.rows[0].nombre}, perfil ${existente.rows[0].perfil}, estado ${existente.rows[0].estado}). Actualícelo o reactívelo en lugar de duplicarlo.`,
        { existente: existente.rows[0] },
      );
    }
    const entidades = await validarAmbito(tx, datos.perfil, datos.entidadIds);
    const temporal = contrasenaTemporal();
    const { rows } = await tx.query(
      `INSERT INTO usuario (documento, nombre, correo, hash_contrasena, perfil, debe_cambiar_contrasena)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
      [datos.documento, datos.nombre, datos.correo, bcrypt.hashSync(temporal, 10), datos.perfil],
    );
    const id = rows[0].id as number;
    await reemplazarAmbito(tx, id, entidades);
    await registrarAuditoria(tx, ctx, {
      operacion: 'CREAR_USUARIO',
      entidadAfectada: 'USUARIO',
      registroId: id,
      valoresNuevos: { documento: datos.documento, nombre: datos.nombre, correo: datos.correo, perfil: datos.perfil, entidades },
      detalle: `Usuario ${datos.correo} creado con perfil ${datos.perfil}; se emitieron credenciales de activación`,
    });
    // En el Piloto se envían por correo; en el MVP se muestran una sola vez al administrador.
    return { id, correo: datos.correo, contrasenaTemporal: temporal };
  });
}

/** Cambio de nombre, perfil o ámbito. Cierra las sesiones abiertas para que el nuevo ámbito rija de inmediato. */
export async function actualizarUsuario(ctx: Contexto, id: number, datos: z.infer<typeof esquemaActualizacion>) {
  return enTransaccion(async (tx) => {
    const actual = await exigirUsuario(tx, id, true);
    const previo = await tx.query(`SELECT array_agg(entidad_id ORDER BY entidad_id) AS e FROM ambito_usuario WHERE usuario_id = $1`, [id]);
    if (actual.perfil === 'TUTOR' && datos.perfil !== 'TUTOR') await exigirSinEstrategias(tx, id, 'cambiar el perfil de');
    const entidades = await validarAmbito(tx, datos.perfil, datos.entidadIds);
    await tx.query(`UPDATE usuario SET nombre = $2, perfil = $3, version_sesion = version_sesion + 1 WHERE id = $1`, [
      id,
      datos.nombre,
      datos.perfil,
    ]);
    await reemplazarAmbito(tx, id, entidades);
    await registrarAuditoria(tx, ctx, {
      operacion: 'ACTUALIZAR_USUARIO',
      entidadAfectada: 'USUARIO',
      registroId: id,
      valoresPrevios: { nombre: actual.nombre, perfil: actual.perfil, entidades: previo.rows[0].e ?? [] },
      valoresNuevos: { nombre: datos.nombre, perfil: datos.perfil, entidades },
      detalle: `Usuario ${actual.correo} actualizado; sus sesiones abiertas se cerraron`,
    });
    return { id };
  });
}

/** Estrategias vigentes de un tutor: impiden inactivarlo sin reasignarlas antes. */
async function estrategiasACargo(db: Ejecutor, tutorId: number) {
  const { rows } = await db.query(
    `SELECT e.id, e.codigo, e.nombre, e.entidad_id AS "entidadId", en.nombre AS "entidadNombre",
            (SELECT count(*) FROM estrategia_tutor x WHERE x.estrategia_id = e.id)::int AS tutores
       FROM estrategia_tutor et JOIN estrategia e ON e.id = et.estrategia_id JOIN entidad en ON en.id = e.entidad_id
      WHERE et.usuario_id = $1 AND e.fecha_fin >= $2
      ORDER BY e.nombre`,
    [tutorId, hoy()],
  );
  return rows as { id: number; codigo: string; nombre: string; entidadId: number; entidadNombre: string; tutores: number }[];
}

async function exigirSinEstrategias(db: Ejecutor, tutorId: number, accion: string) {
  const pendientes = await estrategiasACargo(db, tutorId);
  if (pendientes.length) {
    throw new AppError(
      409,
      'TUTOR_CON_ESTRATEGIAS',
      `No puede ${accion} un tutor con ${pendientes.length} estrategia(s) vigente(s) a cargo. Reasígnelas antes a otro tutor.`,
      { estrategias: pendientes },
    );
  }
}

/** Tutores activos que pueden recibir las estrategias de quien se retira. */
export async function candidatosDeReasignacion(id: number) {
  const pendientes = await estrategiasACargo(pool, id);
  const resultado = [];
  for (const e of pendientes) {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre FROM usuario u JOIN ambito_usuario a ON a.usuario_id = u.id
        WHERE a.entidad_id = $1 AND u.perfil = 'TUTOR' AND u.estado = 'ACTIVO' AND u.id <> $2
        ORDER BY u.nombre`,
      [e.entidadId, id],
    );
    resultado.push({ ...e, candidatos: rows });
  }
  return resultado;
}

/**
 * Revoca el acceso: la cuenta queda inactiva y sus sesiones se cierran de inmediato.
 * Si es un tutor con estrategias vigentes, exige reasignarlas; lo ya registrado sigue atribuido a su autor.
 */
export async function revocarUsuario(ctx: Contexto, id: number, datos: z.infer<typeof esquemaRevocacion>) {
  if (id === ctx.usuario.id) throw new AppError(409, 'AUTO_REVOCACION', 'No puede revocar su propio acceso.');
  return enTransaccion(async (tx) => {
    const usuario = await exigirUsuario(tx, id, true);
    if (usuario.estado === 'INACTIVO') throw new AppError(409, 'USUARIO_INACTIVO', 'El acceso de este usuario ya está revocado.');

    const reasignadas: string[] = [];
    if (usuario.perfil === 'TUTOR') {
      const pendientes = await estrategiasACargo(tx, id);
      const faltantes = pendientes.filter((e) => !datos.reasignaciones.some((r) => r.estrategiaId === e.id));
      if (faltantes.length) {
        throw new AppError(
          409,
          'TUTOR_CON_ESTRATEGIAS',
          `El tutor tiene ${pendientes.length} estrategia(s) vigente(s) a cargo. Indique a quién se reasigna cada una antes de revocar su acceso.`,
          { estrategias: faltantes },
        );
      }
      for (const r of datos.reasignaciones) {
        const estrategia = pendientes.find((e) => e.id === r.estrategiaId);
        if (!estrategia) continue;
        const habilitado = await tx.query(
          `SELECT u.nombre FROM usuario u JOIN ambito_usuario a ON a.usuario_id = u.id
            WHERE u.id = $1 AND a.entidad_id = $2 AND u.perfil = 'TUTOR' AND u.estado = 'ACTIVO'`,
          [r.tutorId, estrategia.entidadId],
        );
        if (!habilitado.rows[0] || r.tutorId === id) {
          throw new AppError(400, 'TUTOR_NO_HABILITADO', `El tutor elegido para ${estrategia.codigo} no está habilitado para esa entidad.`);
        }
        await tx.query(`DELETE FROM estrategia_tutor WHERE estrategia_id = $1 AND usuario_id = $2`, [r.estrategiaId, id]);
        await tx.query(
          `INSERT INTO estrategia_tutor (estrategia_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [r.estrategiaId, r.tutorId],
        );
        reasignadas.push(`${estrategia.codigo} → ${habilitado.rows[0].nombre}`);
        await registrarAuditoria(tx, ctx, {
          operacion: 'REASIGNAR_ESTRATEGIA',
          entidadAfectada: 'ESTRATEGIA',
          registroId: r.estrategiaId,
          valoresPrevios: { tutor: usuario.nombre },
          valoresNuevos: { tutor: habilitado.rows[0].nombre },
          detalle: `${estrategia.codigo} reasignada por retiro de ${usuario.nombre}; sus registros conservan el autor original`,
        });
      }
    }

    await tx.query(
      `UPDATE usuario SET estado = 'INACTIVO', motivo_estado = $2, version_sesion = version_sesion + 1 WHERE id = $1`,
      [id, datos.motivo],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'REVOCAR_ACCESO',
      entidadAfectada: 'USUARIO',
      registroId: id,
      valoresPrevios: { estado: usuario.estado },
      valoresNuevos: { estado: 'INACTIVO', motivo: datos.motivo, reasignadas },
      detalle: `Acceso de ${usuario.correo} revocado: ${datos.motivo}. Sesiones activas cerradas`,
    });
    return { id, estado: 'INACTIVO', reasignadas };
  });
}

export async function reactivarUsuario(ctx: Contexto, id: number) {
  return enTransaccion(async (tx) => {
    const usuario = await exigirUsuario(tx, id, true);
    if (usuario.estado !== 'INACTIVO') throw new AppError(409, 'USUARIO_ACTIVO', 'La cuenta no está inactiva.');
    const temporal = contrasenaTemporal();
    await tx.query(
      `UPDATE usuario SET estado = 'ACTIVO', motivo_estado = NULL, intentos_fallidos = 0,
              hash_contrasena = $2, debe_cambiar_contrasena = TRUE WHERE id = $1`,
      [id, bcrypt.hashSync(temporal, 10)],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'REACTIVAR_USUARIO',
      entidadAfectada: 'USUARIO',
      registroId: id,
      valoresPrevios: { estado: 'INACTIVO' },
      valoresNuevos: { estado: 'ACTIVO' },
      detalle: `Cuenta ${usuario.correo} reactivada con nuevas credenciales de activación`,
    });
    return { id, correo: usuario.correo, contrasenaTemporal: temporal };
  });
}

/** Emite nuevas credenciales de activación y cierra las sesiones abiertas. */
export async function restablecerContrasena(ctx: Contexto, id: number) {
  return enTransaccion(async (tx) => {
    const usuario = await exigirUsuario(tx, id, true);
    if (usuario.estado === 'INACTIVO') throw new AppError(409, 'USUARIO_INACTIVO', 'Reactive la cuenta antes de restablecer su contraseña.');
    const temporal = contrasenaTemporal();
    await tx.query(
      `UPDATE usuario SET hash_contrasena = $2, debe_cambiar_contrasena = TRUE, estado = 'ACTIVO', intentos_fallidos = 0,
              version_sesion = version_sesion + 1 WHERE id = $1`,
      [id, bcrypt.hashSync(temporal, 10)],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'RESTABLECER_CONTRASENA',
      entidadAfectada: 'USUARIO',
      registroId: id,
      detalle: `Nuevas credenciales de activación para ${usuario.correo}; sesiones abiertas cerradas`,
    });
    return { id, correo: usuario.correo, contrasenaTemporal: temporal };
  });
}

/** Habilita de nuevo una cuenta bloqueada por intentos fallidos. */
export async function desbloquearUsuario(ctx: Contexto, usuarioId: number) {
  return enTransaccion(async (tx) => {
    const usuario = await exigirUsuario(tx, usuarioId, true);
    if (usuario.estado !== 'BLOQUEADO') {
      throw new AppError(409, 'USUARIO_NO_BLOQUEADO', 'La cuenta no está bloqueada.');
    }
    await tx.query(`UPDATE usuario SET estado = 'ACTIVO', intentos_fallidos = 0 WHERE id = $1`, [usuarioId]);
    await registrarAuditoria(tx, ctx, {
      operacion: 'DESBLOQUEAR_USUARIO',
      entidadAfectada: 'USUARIO',
      registroId: usuarioId,
      valoresPrevios: { estado: 'BLOQUEADO' },
      valoresNuevos: { estado: 'ACTIVO' },
      detalle: `Cuenta ${usuario.correo} habilitada`,
    });
    return { id: usuarioId, estado: 'ACTIVO' };
  });
}

/** Catálogo completo de entidades, con su carga, para configurar ámbitos y verificar las cargas. */
export async function entidadesConCarga() {
  const { rows } = await pool.query(
    `SELECT e.id, e.codigo, e.nombre, e.municipio, e.territorio,
            (SELECT count(*) FROM estudiante s WHERE s.entidad_id = e.id)::int AS estudiantes,
            (SELECT count(*) FROM docente d WHERE d.entidad_id = e.id)::int AS docentes
       FROM entidad e ORDER BY e.territorio, e.nombre`,
  );
  return rows;
}
