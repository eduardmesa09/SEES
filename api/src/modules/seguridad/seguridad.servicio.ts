import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../../config';
import { Contexto, UsuarioSesion } from '../../contexto';
import { Ejecutor, enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';

const CREDENCIALES_INVALIDAS = 'Credenciales inválidas. Verifique el correo y la contraseña.';

/** CU-01: política de complejidad de la contraseña propia. */
export const POLITICA_CONTRASENA =
  'Al menos 8 caracteres, con mayúscula, minúscula, número y un símbolo.';

export function validarPolitica(contrasena: string): void {
  const cumple =
    contrasena.length >= 8 &&
    /[A-Z]/.test(contrasena) &&
    /[a-z]/.test(contrasena) &&
    /\d/.test(contrasena) &&
    /[^A-Za-z0-9]/.test(contrasena);
  if (!cumple) {
    throw new AppError(400, 'CONTRASENA_DEBIL', `La contraseña no cumple la política: ${POLITICA_CONTRASENA}`, {
      campos: { nueva: POLITICA_CONTRASENA },
    });
  }
}

/** Región desde la que opera el usuario, según los territorios de su ámbito. */
export async function regionDe(db: Ejecutor, entidades: number[]): Promise<string> {
  if (!entidades.length) return 'Nacional';
  const { rows } = await db.query(
    `SELECT DISTINCT territorio FROM entidad WHERE id = ANY($1::int[]) ORDER BY territorio`,
    [entidades],
  );
  return rows.map((r) => r.territorio as string).join(' y ') || 'Nacional';
}

/** CU-01: autentica, determina perfil y ámbito, y emite la sesión. Todo intento queda registrado. */
export async function iniciarSesion(correo: string, contrasena: string, ip: string | null) {
  const { rows } = await pool.query(
    `SELECT id, nombre, correo, hash_contrasena, perfil, estado, intentos_fallidos, version_sesion,
            debe_cambiar_contrasena
       FROM usuario WHERE lower(correo) = lower($1)`,
    [correo.trim()],
  );
  const usuario = rows[0];
  const quien = { correo: correo.trim(), ip, usuarioId: usuario?.id ?? null };

  if (!usuario) {
    await registrarAuditoria(pool, quien, {
      operacion: 'LOGIN_FALLIDO',
      entidadAfectada: 'USUARIO',
      detalle: 'Intento de ingreso con credenciales inválidas',
    });
    // No se precisa si falló el usuario o la contraseña.
    throw new AppError(401, 'CREDENCIALES_INVALIDAS', CREDENCIALES_INVALIDAS);
  }

  if (usuario.estado === 'INACTIVO') {
    await registrarAuditoria(pool, quien, {
      operacion: 'LOGIN_RECHAZADO',
      entidadAfectada: 'USUARIO',
      registroId: usuario.id,
      detalle: 'Cuenta inactiva: acceso revocado',
    });
    throw new AppError(403, 'ACCESO_REVOCADO', 'El acceso fue revocado. Comuníquese con el administrador.');
  }

  if (usuario.estado === 'BLOQUEADO') {
    await registrarAuditoria(pool, quien, {
      operacion: 'LOGIN_RECHAZADO',
      entidadAfectada: 'USUARIO',
      registroId: usuario.id,
      detalle: 'Cuenta bloqueada por intentos fallidos',
    });
    throw new AppError(423, 'CUENTA_BLOQUEADA', 'La cuenta está bloqueada. Solicite su habilitación al administrador.');
  }

  const coincide = await bcrypt.compare(contrasena, usuario.hash_contrasena);
  if (!coincide) {
    const intentos = usuario.intentos_fallidos + 1;
    const bloquear = intentos >= config.maxIntentosFallidos;
    await pool.query(`UPDATE usuario SET intentos_fallidos = $2, estado = $3 WHERE id = $1`, [
      usuario.id,
      intentos,
      bloquear ? 'BLOQUEADO' : usuario.estado,
    ]);
    await registrarAuditoria(pool, quien, {
      operacion: bloquear ? 'CUENTA_BLOQUEADA' : 'LOGIN_FALLIDO',
      entidadAfectada: 'USUARIO',
      registroId: usuario.id,
      detalle: `Intento fallido ${intentos} de ${config.maxIntentosFallidos}`,
    });
    if (bloquear) {
      throw new AppError(
        423,
        'CUENTA_BLOQUEADA',
        'La cuenta fue bloqueada por cinco intentos fallidos consecutivos. Solicite su habilitación al administrador.',
      );
    }
    throw new AppError(401, 'CREDENCIALES_INVALIDAS', CREDENCIALES_INVALIDAS);
  }

  const ambito = await pool.query(`SELECT entidad_id FROM ambito_usuario WHERE usuario_id = $1 ORDER BY entidad_id`, [
    usuario.id,
  ]);
  const entidades = ambito.rows.map((r) => r.entidad_id as number);
  const sesion: UsuarioSesion = {
    id: usuario.id,
    nombre: usuario.nombre,
    correo: usuario.correo,
    perfil: usuario.perfil,
    entidades,
    region: await regionDe(pool, entidades),
    debeCambiarContrasena: usuario.debe_cambiar_contrasena,
  };

  await pool.query(`UPDATE usuario SET intentos_fallidos = 0, ultimo_acceso = now() WHERE id = $1`, [usuario.id]);
  await registrarAuditoria(pool, { usuario: sesion, ip }, {
    operacion: 'LOGIN_EXITOSO',
    entidadAfectada: 'USUARIO',
    registroId: usuario.id,
    detalle: `Ingreso con perfil ${usuario.perfil} desde la región ${sesion.region}${sesion.debeCambiarContrasena ? ' (primer ingreso: debe definir su contraseña)' : ''}`,
  });

  return { ...emitirToken(sesion, usuario.version_sesion), usuario: sesion };
}

function emitirToken(sesion: UsuarioSesion, versionSesion: number) {
  const token = jwt.sign(
    {
      nombre: sesion.nombre,
      correo: sesion.correo,
      perfil: sesion.perfil,
      entidades: sesion.entidades,
      region: sesion.region,
      ver: versionSesion,
    },
    config.jwtSecreto,
    { subject: String(sesion.id), expiresIn: config.jwtTtlSegundos },
  );
  return { token, expiraEnSegundos: config.jwtTtlSegundos };
}

export const esquemaCambioContrasena = z.object({
  actual: z.string().min(1),
  nueva: z.string().min(1).max(100),
});

/** CU-01, tercer flujo: el usuario define su propia contraseña. Recibe una sesión nueva sin restricción. */
export async function cambiarContrasena(ctx: Contexto, datos: z.infer<typeof esquemaCambioContrasena>) {
  return enTransaccion(async (tx) => {
    const { rows } = await tx.query(`SELECT hash_contrasena, version_sesion FROM usuario WHERE id = $1 FOR UPDATE`, [
      ctx.usuario.id,
    ]);
    const cuenta = rows[0];
    if (!(await bcrypt.compare(datos.actual, cuenta.hash_contrasena))) {
      throw new AppError(400, 'CONTRASENA_ACTUAL_INVALIDA', 'La contraseña actual no es correcta.', {
        campos: { actual: 'No coincide con la contraseña actual' },
      });
    }
    validarPolitica(datos.nueva);
    if (await bcrypt.compare(datos.nueva, cuenta.hash_contrasena)) {
      throw new AppError(400, 'CONTRASENA_REPETIDA', 'La nueva contraseña debe ser distinta de la actual.', {
        campos: { nueva: 'Debe ser distinta de la actual' },
      });
    }
    await tx.query(
      `UPDATE usuario SET hash_contrasena = $2, debe_cambiar_contrasena = FALSE WHERE id = $1`,
      [ctx.usuario.id, bcrypt.hashSync(datos.nueva, 10)],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'CAMBIAR_CONTRASENA',
      entidadAfectada: 'USUARIO',
      registroId: ctx.usuario.id,
      detalle: 'El usuario definió su propia contraseña',
    });
    const sesion = { ...ctx.usuario, debeCambiarContrasena: false };
    return { ...emitirToken(sesion, cuenta.version_sesion), usuario: sesion };
  });
}
