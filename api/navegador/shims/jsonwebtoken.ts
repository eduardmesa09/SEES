/**
 * Reemplazo de `jsonwebtoken` para el navegador: JWT HS256 síncrono con `sign` y `verify`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { bytes, sha256 } from './crypto';

export type JwtPayload = Record<string, any>;

function hmac(clave: string, mensaje: string): Uint8Array {
  let k = bytes(clave);
  if (k.length > 64) k = sha256(k);
  const bloque = new Uint8Array(64);
  bloque.set(k);
  const interno = new Uint8Array(64 + bytes(mensaje).length);
  const externo = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    interno[i] = bloque[i] ^ 0x36;
    externo[i] = bloque[i] ^ 0x5c;
  }
  interno.set(bytes(mensaje), 64);
  externo.set(sha256(interno), 64);
  return sha256(externo);
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textoB64url = (t: string) => b64url(bytes(t));
const desdeB64url = (t: string) => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function sign(payload: JwtPayload, secreto: string, opciones: { expiresIn?: number; subject?: string } = {}): string {
  const ahora = Math.floor(Date.now() / 1000);
  const datos: JwtPayload = { ...payload, iat: ahora };
  if (opciones.expiresIn) datos.exp = ahora + Number(opciones.expiresIn);
  if (opciones.subject) datos.sub = opciones.subject;
  const cuerpo = `${textoB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${textoB64url(JSON.stringify(datos))}`;
  return `${cuerpo}.${b64url(hmac(secreto, cuerpo))}`;
}

export function verify(token: string, secreto: string): JwtPayload {
  const [cabecera, carga, firma] = token.split('.');
  if (!cabecera || !carga || firma !== b64url(hmac(secreto, `${cabecera}.${carga}`))) throw new Error('firma inválida');
  const datos = JSON.parse(desdeB64url(carga));
  if (datos.exp && datos.exp < Date.now() / 1000) throw new Error('token vencido');
  return datos;
}

export default { sign, verify };
