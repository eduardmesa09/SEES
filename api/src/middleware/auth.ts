import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { PERFILES_DE_CONSULTA, Perfil, UsuarioSesion, ipDe } from '../contexto';
import { pool } from '../db';
import { AppError } from '../errores';
import { registrarAuditoria } from '../modules/auditoria/auditoria.servicio';

/**
 * Verifica el token y deja en la petición la identidad, el perfil y el ámbito.
 *
 * Además del token, se confirma contra la base de datos que la cuenta siga activa y que la
 * sesión no haya sido revocada: al inactivar a una persona o cambiar su perfil, el administrador
 * incrementa `version_sesion` y los tokens emitidos antes dejan de valer de inmediato (CU-14).
 */
export const autenticar: RequestHandler = (req, _res, next) => {
  const cabecera = req.headers.authorization ?? '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) {
    next(new AppError(401, 'NO_AUTENTICADO', 'Debe iniciar sesión para continuar.'));
    return;
  }
  let datos: jwt.JwtPayload;
  try {
    datos = jwt.verify(token, config.jwtSecreto) as jwt.JwtPayload;
  } catch {
    next(new AppError(401, 'SESION_VENCIDA', 'La sesión venció o no es válida. Inicie sesión de nuevo.'));
    return;
  }

  pool
    .query(`SELECT estado, version_sesion, debe_cambiar_contrasena FROM usuario WHERE id = $1`, [Number(datos.sub)])
    .then(({ rows }) => {
      const cuenta = rows[0];
      if (!cuenta || cuenta.estado !== 'ACTIVO' || cuenta.version_sesion !== datos.ver) {
        next(new AppError(401, 'SESION_REVOCADA', 'Su sesión fue cerrada por el administrador. Inicie sesión de nuevo.'));
        return;
      }
      req.usuario = {
        id: Number(datos.sub),
        nombre: datos.nombre,
        correo: datos.correo,
        perfil: datos.perfil,
        entidades: datos.entidades ?? [],
        region: datos.region ?? 'Nacional',
        debeCambiarContrasena: cuenta.debe_cambiar_contrasena,
      } satisfies UsuarioSesion;
      next();
    })
    .catch(next);
};

/** Rutas de la propia sesión: se permiten aunque falte el cambio de contraseña o el perfil sea de consulta. */
const RUTAS_DE_SESION = ['/auth/yo', '/auth/cambiar-contrasena', '/auth/salir'];

/**
 * Reglas que valen para cualquier petición autenticada:
 * - CU-01: quien entra con credenciales de activación solo puede definir su contraseña.
 * - RN-08 / RQ_013: un perfil de consulta no puede escribir, aunque invoque la operación directamente.
 */
export const reglasDeSesion: RequestHandler = (req, _res, next) => {
  const usuario = req.usuario;
  if (!usuario) {
    next();
    return;
  }
  if (usuario.debeCambiarContrasena && !RUTAS_DE_SESION.includes(req.path)) {
    next(new AppError(403, 'CAMBIO_DE_CONTRASENA_REQUERIDO', 'Debe definir su propia contraseña antes de continuar.'));
    return;
  }
  const escritura = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (escritura && PERFILES_DE_CONSULTA.includes(usuario.perfil) && !RUTAS_DE_SESION.includes(req.path)) {
    rechazarYAuditar(req, usuario, 'Perfil de solo consulta: intentó una operación de escritura', next);
    return;
  }
  next();
};

function rechazarYAuditar(
  req: Parameters<RequestHandler>[0],
  usuario: UsuarioSesion,
  motivo: string,
  next: Parameters<RequestHandler>[2],
) {
  registrarAuditoria(pool, { usuario, ip: ipDe(req) }, {
    operacion: 'ACCESO_DENEGADO',
    entidadAfectada: 'SEGURIDAD',
    detalle: `${motivo}: el perfil ${usuario.perfil} intentó ${req.method} ${req.originalUrl}`,
  })
    .catch((error) => console.error('[auditoria]', error))
    .finally(() => {
      next(new AppError(403, 'PERFIL_NO_AUTORIZADO', 'Su perfil no permite realizar esta operación.'));
    });
}

/**
 * La autorización se resuelve en la capa de servicios y no en la de presentación (RQ_001, RQ_002):
 * aunque la interfaz oculte una opción, la petición directa se rechaza con 403 y queda registrada.
 */
export function requierePerfil(...perfiles: Perfil[]): RequestHandler {
  return (req, _res, next) => {
    const usuario = req.usuario;
    if (!usuario) {
      next(new AppError(401, 'NO_AUTENTICADO', 'Debe iniciar sesión para continuar.'));
      return;
    }
    if (perfiles.includes(usuario.perfil)) {
      next();
      return;
    }
    rechazarYAuditar(req, usuario, 'Operación no permitida para el perfil', next);
  };
}
