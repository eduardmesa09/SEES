import { Request } from 'express';
import { AppError } from './errores';

export type Perfil = 'TUTOR' | 'TUTOR_LIDER' | 'ENTE_CONTROL' | 'ADMIN' | 'SOPORTE';

/** Lo que viaja dentro del token: identidad, perfil y ámbito (RQ_001). */
export interface UsuarioSesion {
  id: number;
  nombre: string;
  correo: string;
  perfil: Perfil;
  /** Entidades sobre las que el usuario puede trabajar. */
  entidades: number[];
  /** Región desde la que opera; alimenta la distribución geográfica del monitoreo (CU-15). */
  region: string;
  /** CU-01: con credenciales de activación solo puede definir su contraseña. */
  debeCambiarContrasena: boolean;
}

/** Perfiles de solo lectura: cualquier verbo de escritura se rechaza (RN-08, RQ_013). */
export const PERFILES_DE_CONSULTA: Perfil[] = ['ENTE_CONTROL'];

/** Quién ejecuta la operación y desde dónde; se propaga a los servicios para auditar. */
export interface Contexto {
  usuario: UsuarioSesion;
  ip: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioSesion;
    }
  }
}

export function ipDe(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export function contextoDe(req: Request): Contexto {
  if (!req.usuario) throw new AppError(401, 'NO_AUTENTICADO', 'Debe iniciar sesión.');
  return { usuario: req.usuario, ip: ipDe(req) };
}
