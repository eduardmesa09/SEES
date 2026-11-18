import { Contexto } from '../../contexto';
import { Ejecutor, pool } from '../../db';

export interface EventoAuditoria {
  operacion: string;
  entidadAfectada: string;
  registroId?: string | number | null;
  valoresPrevios?: unknown;
  valoresNuevos?: unknown;
  detalle?: string;
}

/**
 * Escribe una fila en la bitácora de solo anexado (RQ_017).
 *
 * Las operaciones exitosas se auditan dentro de su misma transacción (pasando `tx`),
 * de modo que no exista operación sin traza. Los rechazos se auditan sobre el pool,
 * porque la transacción que los originó se revierte y la traza debe sobrevivir.
 */
export async function registrarAuditoria(
  db: Ejecutor,
  quien: Contexto | { correo: string; ip: string | null; usuarioId?: number | null },
  evento: EventoAuditoria,
): Promise<void> {
  const usuarioId = 'usuario' in quien ? quien.usuario.id : (quien.usuarioId ?? null);
  const correo = 'usuario' in quien ? quien.usuario.correo : quien.correo;
  await db.query(
    `INSERT INTO auditoria
       (usuario_id, usuario_correo, operacion, entidad_afectada, registro_id, valores_previos, valores_nuevos, detalle, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      usuarioId,
      correo,
      evento.operacion,
      evento.entidadAfectada,
      evento.registroId == null ? null : String(evento.registroId),
      evento.valoresPrevios === undefined ? null : JSON.stringify(evento.valoresPrevios),
      evento.valoresNuevos === undefined ? null : JSON.stringify(evento.valoresNuevos),
      evento.detalle ?? null,
      quien.ip,
    ],
  );
}

export interface FiltrosAuditoria {
  operacion?: string;
  q?: string;
  pagina: number;
  tamano: number;
}

export async function consultarAuditoria(filtros: FiltrosAuditoria) {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtros.operacion) {
    params.push(filtros.operacion);
    condiciones.push(`a.operacion = $${params.length}`);
  }
  if (filtros.q) {
    params.push(`%${filtros.q.toLowerCase()}%`);
    condiciones.push(
      `(lower(a.usuario_correo) LIKE $${params.length} OR lower(coalesce(a.detalle, '')) LIKE $${params.length} OR lower(a.entidad_afectada) LIKE $${params.length})`,
    );
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const total = await pool.query(`SELECT count(*) AS total FROM auditoria a ${where}`, params);
  const filas = await pool.query(
    `SELECT a.id, a.fecha, a.usuario_correo AS "usuarioCorreo", u.nombre AS "usuarioNombre", u.perfil,
            a.operacion, a.entidad_afectada AS "entidadAfectada", a.registro_id AS "registroId",
            a.valores_previos AS "valoresPrevios", a.valores_nuevos AS "valoresNuevos", a.detalle, a.ip
       FROM auditoria a
       LEFT JOIN usuario u ON u.id = a.usuario_id
       ${where}
      ORDER BY a.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filtros.tamano, (filtros.pagina - 1) * filtros.tamano],
  );
  const operaciones = await pool.query(`SELECT DISTINCT operacion FROM auditoria ORDER BY operacion`);

  return {
    total: total.rows[0].total as number,
    pagina: filtros.pagina,
    tamano: filtros.tamano,
    operaciones: operaciones.rows.map((r) => r.operacion as string),
    registros: filas.rows,
  };
}
