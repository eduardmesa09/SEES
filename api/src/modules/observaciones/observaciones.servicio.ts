import { z } from 'zod';
import { Contexto } from '../../contexto';
import { enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { nombreDelMes } from '../../domain/semanas';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';
import { exigirEstrategia } from '../estrategias/estrategias.servicio';

/** CU-11: observación del tutor líder dirigida a un tutor, registrada con su autor y su fecha. */
export const esquemaObservacion = z.object({
  tutorId: z.number().int().positive(),
  estrategiaId: z.number().int().positive().optional(),
  anio: z.number().int(),
  mes: z.number().int().min(1).max(12),
  texto: z.string().trim().min(10).max(2000),
});

export async function crearObservacion(ctx: Contexto, datos: z.infer<typeof esquemaObservacion>) {
  return enTransaccion(async (tx) => {
    // Solo se observa a tutores que trabajan en el territorio del tutor líder.
    const tutor = await tx.query(
      `SELECT DISTINCT u.id, u.nombre, u.correo FROM usuario u JOIN ambito_usuario a ON a.usuario_id = u.id
        WHERE u.id = $1 AND u.perfil = 'TUTOR' AND a.entidad_id = ANY($2::int[])`,
      [datos.tutorId, ctx.usuario.entidades],
    );
    if (!tutor.rows[0]) throw new AppError(403, 'TUTOR_FUERA_DE_AMBITO', 'El tutor no trabaja en su territorio.');
    const estrategia = datos.estrategiaId ? await exigirEstrategia(tx, ctx, datos.estrategiaId) : null;
    const { rows } = await tx.query(
      `INSERT INTO observacion (tutor_id, autor_id, estrategia_id, anio, mes, texto)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, creado_en AS "creadoEn"`,
      [datos.tutorId, ctx.usuario.id, estrategia?.id ?? null, datos.anio, datos.mes, datos.texto],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'REGISTRAR_OBSERVACION',
      entidadAfectada: 'USUARIO',
      registroId: datos.tutorId,
      valoresNuevos: { tutor: tutor.rows[0].nombre, estrategia: estrategia?.codigo ?? null, periodo: nombreDelMes(datos.anio, datos.mes), texto: datos.texto },
      detalle: `Observación dirigida a ${tutor.rows[0].nombre} sobre ${nombreDelMes(datos.anio, datos.mes)}`,
    });
    return { id: rows[0].id, creadoEn: rows[0].creadoEn, tutor: tutor.rows[0].nombre };
  });
}

const SELECT_OBSERVACION = `
  SELECT o.id, o.anio, o.mes, o.texto, o.creado_en AS "creadoEn", o.leida_en AS "leidaEn",
         autor.nombre AS autor, tutor.nombre AS tutor, e.codigo AS "estrategiaCodigo", e.nombre AS "estrategiaNombre"
    FROM observacion o
    JOIN usuario autor ON autor.id = o.autor_id
    JOIN usuario tutor ON tutor.id = o.tutor_id
    LEFT JOIN estrategia e ON e.id = o.estrategia_id`;

/** El tutor ve las observaciones que le hicieron; el tutor líder, las que escribió. */
export async function listarObservaciones(ctx: Contexto) {
  const columna = ctx.usuario.perfil === 'TUTOR' ? 'o.tutor_id' : 'o.autor_id';
  const { rows } = await pool.query(`${SELECT_OBSERVACION} WHERE ${columna} = $1 ORDER BY o.id DESC`, [ctx.usuario.id]);
  return rows.map((r) => ({ ...r, periodo: nombreDelMes(r.anio, r.mes) }));
}

export async function marcarLeida(ctx: Contexto, id: number) {
  const { rowCount } = await pool.query(
    `UPDATE observacion SET leida_en = coalesce(leida_en, now()) WHERE id = $1 AND tutor_id = $2`,
    [id, ctx.usuario.id],
  );
  if (!rowCount) throw new AppError(404, 'OBSERVACION_NO_ENCONTRADA', 'La observación no existe.');
  return { id };
}

export async function observacionesSinLeer(ctx: Contexto): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM observacion WHERE tutor_id = $1 AND leida_en IS NULL`, [ctx.usuario.id]);
  return rows[0].n;
}
