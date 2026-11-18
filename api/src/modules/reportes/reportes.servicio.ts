import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Contexto } from '../../contexto';
import { enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { porcentaje } from '../../domain/cobertura';
import { hoy } from '../../domain/reglas';
import { nombreDelMes, rangoDelMes } from '../../domain/semanas';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';
import { consultarTablero } from '../tablero/tablero.servicio';

/**
 * CU-12 / RQ_012: reportes de ley. CU-13 / RQ_013: reportes de control.
 * Ambos se construyen con el mismo consolidado; lo que cambia es quién lo consulta y si está certificado.
 */

export const TIPO_REPORTE = 'CONSOLIDADO_MENSUAL';
export const TODOS = 'TODOS';

export interface FiltrosConsolidado {
  anio: number;
  mes: number;
  territorio?: string;
  entidadId?: number;
  estrategiaId?: number;
  excluir?: number[];
}

/** Cifras consolidadas del programa, cada una con la cobertura de información que la respalda. */
export async function consolidar(ctx: Contexto, filtros: FiltrosConsolidado) {
  const tablero = await consultarTablero(ctx, filtros);
  const excluidas = new Set(filtros.excluir ?? []);
  const incluidas = tablero.estrategias.filter((e) => !excluidas.has(e.id));
  const cerradas = incluidas.filter((e) => e.periodo.estado === 'CERRADO');
  const suma = (lista: typeof incluidas, campo: 'vinculados' | 'docentesAsignados' | 'docentesAcompanados' | 'acompanamientosIndividuales' | 'sesionesGrupales' | 'semanasReportadas' | 'semanasEsperadas') =>
    lista.reduce((t, e) => t + e[campo], 0);

  const agrupar = (clave: (e: (typeof incluidas)[number]) => string) => {
    const grupos = new Map<string, typeof incluidas>();
    for (const e of incluidas) grupos.set(clave(e), [...(grupos.get(clave(e)) ?? []), e]);
    return [...grupos.entries()].map(([nombre, lista]) => ({
      nombre,
      territorio: lista[0].territorio,
      estrategias: lista.length,
      estudiantesVinculados: suma(lista, 'vinculados'),
      docentesAcompanados: suma(lista, 'docentesAcompanados'),
      docentesAsignados: suma(lista, 'docentesAsignados'),
      acompanamientosIndividuales: suma(lista, 'acompanamientosIndividuales'),
      sesionesGrupales: suma(lista, 'sesionesGrupales'),
      coberturaSemanalPct: porcentaje(suma(lista, 'semanasReportadas'), suma(lista, 'semanasEsperadas')),
      coberturaInformacionPct: porcentaje(lista.filter((e) => e.periodo.estado === 'CERRADO').length, lista.length),
    }));
  };

  return {
    periodo: { anio: filtros.anio, mes: filtros.mes, nombre: nombreDelMes(filtros.anio, filtros.mes) },
    fechaCorte: new Date().toISOString(),
    cifras: {
      estrategiasActivas: incluidas.length,
      estudiantesVinculados: suma(incluidas, 'vinculados'),
      docentesAsignados: suma(incluidas, 'docentesAsignados'),
      docentesAcompanados: suma(incluidas, 'docentesAcompanados'),
      acompanamientosIndividuales: suma(incluidas, 'acompanamientosIndividuales'),
      sesionesGrupales: suma(incluidas, 'sesionesGrupales'),
      semanasEsperadas: suma(incluidas, 'semanasEsperadas'),
      semanasReportadas: suma(incluidas, 'semanasReportadas'),
      coberturaSemanalPct: porcentaje(suma(incluidas, 'semanasReportadas'), suma(incluidas, 'semanasEsperadas')),
    },
    // Qué proporción del programa está efectivamente representada por periodos cerrados.
    coberturaInformacion: {
      estrategiasDelAlcance: tablero.estrategias.length,
      estrategiasCerradas: cerradas.length,
      estrategiasExcluidas: tablero.estrategias.length - incluidas.length,
      porcentaje: porcentaje(cerradas.length, tablero.estrategias.length),
    },
    porTerritorio: agrupar((e) => e.territorio),
    porEntidad: agrupar((e) => e.entidadNombre),
    pendientes: incluidas
      .filter((e) => e.periodo.estado !== 'CERRADO')
      .map((e) => ({ estrategiaId: e.id, codigo: e.codigo, nombre: e.nombre, entidadNombre: e.entidadNombre, tutores: e.tutores.map((t) => t.nombre) })),
    estrategias: tablero.estrategias,
    tutores: tablero.tutores,
  };
}

export type Consolidado = Awaited<ReturnType<typeof consolidar>>;

async function versionesCertificadas(anio: number, mes: number, alcance: string) {
  const { rows } = await pool.query(
    `SELECT r.id, r.version, r.alcance, r.codigo_verificacion AS "codigoVerificacion", r.certificado_en AS "certificadoEn",
            u.nombre AS "certificadoPor", r.motivo_ajuste AS "motivoAjuste", r.exclusiones
       FROM reporte_certificado r JOIN usuario u ON u.id = r.certificado_por
      WHERE r.tipo = $1 AND r.anio = $2 AND r.mes = $3 AND r.alcance = $4
      ORDER BY r.version DESC`,
    [TIPO_REPORTE, anio, mes, alcance],
  );
  return rows;
}

/** Versión vigente de un reporte certificado (la de mayor versión), con su contenido congelado. */
export async function certificadoVigente(anio: number, mes: number, alcance: string) {
  const { rows } = await pool.query(
    `SELECT r.id, r.version, r.alcance, r.datos, r.exclusiones, r.codigo_verificacion AS "codigoVerificacion",
            r.certificado_en AS "certificadoEn", u.nombre AS "certificadoPor", r.motivo_ajuste AS "motivoAjuste"
       FROM reporte_certificado r JOIN usuario u ON u.id = r.certificado_por
      WHERE r.tipo = $1 AND r.anio = $2 AND r.mes = $3 AND r.alcance = $4
      ORDER BY r.version DESC LIMIT 1`,
    [TIPO_REPORTE, anio, mes, alcance],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------------
// CU-12: reportes de ley (tutor líder)
// ---------------------------------------------------------------------------------------

export const esquemaCertificacion = z.object({
  anio: z.number().int(),
  mes: z.number().int().min(1).max(12),
  territorio: z.string().trim().min(1).optional(),
  exclusiones: z.array(z.object({ estrategiaId: z.number().int().positive(), motivo: z.string().trim().min(10).max(500) })).default([]),
  motivoAjuste: z.string().trim().min(10).max(1000).optional(),
});

export async function previsualizarReporteDeLey(ctx: Contexto, filtros: { anio: number; mes: number; territorio?: string; excluir?: number[] }) {
  const consolidado = await consolidar(ctx, filtros);
  const alcance = filtros.territorio ?? TODOS;
  return {
    ...consolidado,
    alcance,
    mesTerminado: rangoDelMes(filtros.anio, filtros.mes).fin < hoy(),
    certificable: consolidado.pendientes.length === 0 && consolidado.cifras.estrategiasActivas > 0,
    versiones: await versionesCertificadas(filtros.anio, filtros.mes, alcance),
  };
}

/** Certifica y congela el reporte. Una recertificación crea una nueva versión y conserva la anterior. */
export async function certificarReporte(ctx: Contexto, datos: z.infer<typeof esquemaCertificacion>) {
  const alcance = datos.territorio ?? TODOS;
  const nombre = nombreDelMes(datos.anio, datos.mes);
  if (rangoDelMes(datos.anio, datos.mes).fin >= hoy()) {
    throw new AppError(409, 'PERIODO_EN_CURSO', `El periodo ${nombre} aún no ha terminado: no puede certificarse.`);
  }
  const consolidado = await consolidar(ctx, { ...datos, excluir: datos.exclusiones.map((x) => x.estrategiaId) });
  if (consolidado.cifras.estrategiasActivas === 0) {
    throw new AppError(409, 'SIN_INFORMACION', 'El alcance seleccionado no contiene ningún periodo con registros: no hay información suficiente para el reporte.');
  }
  // RN-09: los reportes de ley se generan únicamente sobre periodos cerrados.
  if (consolidado.pendientes.length) {
    throw new AppError(
      409,
      'PERIODOS_ABIERTOS',
      `Hay ${consolidado.pendientes.length} periodo(s) sin cerrar en el alcance. Espere a que se cierren o exclúyalos dejando constancia del motivo.`,
      { pendientes: consolidado.pendientes },
    );
  }

  return enTransaccion(async (tx) => {
    const previa = await tx.query(
      `SELECT max(version) AS version FROM reporte_certificado WHERE tipo = $1 AND anio = $2 AND mes = $3 AND alcance = $4`,
      [TIPO_REPORTE, datos.anio, datos.mes, alcance],
    );
    const versionPrevia = (previa.rows[0].version as number | null) ?? 0;
    if (versionPrevia > 0 && !datos.motivoAjuste) {
      throw new AppError(
        409,
        'CERTIFICACION_PREVIA',
        `El periodo ${nombre} ya fue certificado (versión ${versionPrevia}). Para emitir una nueva versión indique la justificación del ajuste; la anterior se conserva.`,
        { versionPrevia },
      );
    }
    const exclusiones = datos.exclusiones.map((x) => {
      const e = consolidado.estrategias.find((y) => y.id === x.estrategiaId);
      return { ...x, codigo: e?.codigo ?? null, nombre: e?.nombre ?? null };
    });
    const { estrategias, tutores, pendientes: _p, ...congelado } = consolidado;
    const contenido = { ...congelado, alcance, exclusiones, estrategias: estrategias.filter((e) => !datos.exclusiones.some((x) => x.estrategiaId === e.id)).map((e) => ({
      codigo: e.codigo, nombre: e.nombre, entidad: e.entidadNombre, territorio: e.territorio, tutores: e.tutores.map((t) => t.nombre),
      vinculados: e.vinculados, docentesAcompanados: e.docentesAcompanados, docentesAsignados: e.docentesAsignados,
      acompanamientosIndividuales: e.acompanamientosIndividuales, sesionesGrupales: e.sesionesGrupales,
      semanasReportadas: e.semanasReportadas, semanasEsperadas: e.semanasEsperadas, cierreExtemporaneo: e.periodo.extemporaneo,
    })), tutores };
    const version = versionPrevia + 1;
    const codigo = `SSES-${createHash('sha256').update(JSON.stringify(contenido) + ctx.usuario.id + Date.now()).digest('hex').slice(0, 12).toUpperCase()}`;

    const { rows } = await tx.query(
      `INSERT INTO reporte_certificado (tipo, anio, mes, alcance, version, datos, exclusiones, motivo_ajuste, codigo_verificacion, certificado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, certificado_en AS "certificadoEn"`,
      [TIPO_REPORTE, datos.anio, datos.mes, alcance, version, JSON.stringify(contenido), JSON.stringify(exclusiones), datos.motivoAjuste ?? null, codigo, ctx.usuario.id],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: version > 1 ? 'RECERTIFICAR_REPORTE' : 'CERTIFICAR_REPORTE',
      entidadAfectada: 'REPORTE_DE_LEY',
      registroId: rows[0].id,
      valoresNuevos: { periodo: nombre, alcance, version, codigo, exclusiones: exclusiones.length, cifras: consolidado.cifras },
      detalle: version > 1
        ? `Reporte de ${nombre} (${alcance}) recertificado como versión ${version}: ${datos.motivoAjuste}. La versión anterior se conserva y el ente de control verá que existe`
        : `Reporte de ${nombre} (${alcance}) certificado y congelado con el código ${codigo}`,
    });
    return { id: rows[0].id, version, codigoVerificacion: codigo, certificadoEn: rows[0].certificadoEn, alcance };
  });
}

export async function listarCertificados() {
  const { rows } = await pool.query(
    `SELECT r.id, r.tipo, r.anio, r.mes, r.alcance, r.version, r.codigo_verificacion AS "codigoVerificacion",
            r.certificado_en AS "certificadoEn", u.nombre AS "certificadoPor", r.motivo_ajuste AS "motivoAjuste",
            jsonb_array_length(r.exclusiones) AS exclusiones,
            (r.datos -> 'cifras') AS cifras, (r.datos -> 'coberturaInformacion') AS "coberturaInformacion",
            r.version = (SELECT max(x.version) FROM reporte_certificado x
                          WHERE x.tipo = r.tipo AND x.anio = r.anio AND x.mes = r.mes AND x.alcance = r.alcance) AS vigente
       FROM reporte_certificado r JOIN usuario u ON u.id = r.certificado_por
      ORDER BY r.anio DESC, r.mes DESC, r.alcance, r.version DESC`,
  );
  return rows.map((r) => ({ ...r, periodo: nombreDelMes(r.anio, r.mes) }));
}

/** Comprueba la autenticidad de un reporte a partir de su identificador de verificación. */
export async function verificarCertificado(ctx: Contexto, codigo: string) {
  const { rows } = await pool.query(
    `SELECT r.id, r.anio, r.mes, r.alcance, r.version, r.datos, r.codigo_verificacion AS "codigoVerificacion",
            r.certificado_en AS "certificadoEn", u.nombre AS "certificadoPor", r.motivo_ajuste AS "motivoAjuste",
            r.version = (SELECT max(x.version) FROM reporte_certificado x
                          WHERE x.tipo = r.tipo AND x.anio = r.anio AND x.mes = r.mes AND x.alcance = r.alcance) AS vigente
       FROM reporte_certificado r JOIN usuario u ON u.id = r.certificado_por
      WHERE r.codigo_verificacion = upper($1)`,
    [codigo.trim()],
  );
  await registrarAuditoria(pool, ctx, {
    operacion: 'VERIFICAR_REPORTE',
    entidadAfectada: 'REPORTE_DE_LEY',
    registroId: rows[0]?.id ?? null,
    detalle: rows[0] ? `Verificación del código ${codigo}: auténtico` : `Verificación del código ${codigo}: no corresponde a ningún reporte`,
  });
  if (!rows[0]) throw new AppError(404, 'CODIGO_NO_VALIDO', 'El código no corresponde a ningún reporte certificado.');
  return { ...rows[0], periodo: nombreDelMes(rows[0].anio, rows[0].mes) };
}

// ---------------------------------------------------------------------------------------
// CU-13: reportes de control (ente de control, solo lectura)
// ---------------------------------------------------------------------------------------

export async function reporteDeControl(ctx: Contexto, filtros: FiltrosConsolidado) {
  const consolidado = await consolidar(ctx, filtros);
  const alcance = filtros.territorio ?? TODOS;
  const vigente = await certificadoVigente(filtros.anio, filtros.mes, alcance);
  const anteriores = vigente ? (await versionesCertificadas(filtros.anio, filtros.mes, alcance)).filter((v) => v.version < vigente.version) : [];
  await registrarAuditoria(pool, ctx, {
    operacion: 'CONSULTA_CONTROL',
    entidadAfectada: 'REPORTE_DE_CONTROL',
    valoresNuevos: { filtros },
    detalle: `Consulta del ente de control sobre ${consolidado.periodo.nombre} (${alcance}${filtros.entidadId ? `, entidad ${filtros.entidadId}` : ''}${filtros.estrategiaId ? `, estrategia ${filtros.estrategiaId}` : ''})`,
  });
  return {
    ...consolidado,
    alcance,
    certificacion: vigente
      ? {
          estado: 'CERTIFICADO' as const,
          version: vigente.version,
          codigoVerificacion: vigente.codigoVerificacion,
          certificadoEn: vigente.certificadoEn,
          certificadoPor: vigente.certificadoPor,
          motivoAjuste: vigente.motivoAjuste,
          cifras: vigente.datos.cifras,
          coberturaInformacion: vigente.datos.coberturaInformacion,
          exclusiones: vigente.exclusiones,
          anteriores,
        }
      : { estado: 'PRELIMINAR' as const },
  };
}

const csv = (valor: unknown) => {
  const texto = valor == null ? '' : String(valor);
  return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

/** Archivo descargable: lleva su fecha de corte y su marca de certificación o la leyenda de preliminar. */
export function reporteEnCsv(titulo: string, reporte: Consolidado & { alcance: string; certificacion?: Awaited<ReturnType<typeof reporteDeControl>>['certificacion'] }) {
  const certificado = reporte.certificacion?.estado === 'CERTIFICADO' ? reporte.certificacion : null;
  const lineas: unknown[][] = [
    [titulo],
    ['Periodo', reporte.periodo.nombre],
    ['Alcance', reporte.alcance === TODOS ? 'Todos los territorios' : reporte.alcance],
    ['Fecha de corte', reporte.fechaCorte],
    certificado
      ? ['Estado', `CERTIFICADO - versión ${certificado.version} - código de verificación ${certificado.codigoVerificacion} - ${certificado.certificadoPor}`]
      : ['Estado', 'PRELIMINAR - NO OFICIAL: incluye periodos abiertos y las cifras pueden cambiar'],
    ['Cobertura de información', `${reporte.coberturaInformacion.porcentaje} % (${reporte.coberturaInformacion.estrategiasCerradas} de ${reporte.coberturaInformacion.estrategiasDelAlcance} estrategias con periodo cerrado)`],
    [],
    ['Cifras consolidadas'],
    ['Estrategias activas', reporte.cifras.estrategiasActivas],
    ['Estudiantes vinculados', reporte.cifras.estudiantesVinculados],
    ['Docentes acompañados', `${reporte.cifras.docentesAcompanados} de ${reporte.cifras.docentesAsignados}`],
    ['Acompañamientos individuales', reporte.cifras.acompanamientosIndividuales],
    ['Sesiones grupales', reporte.cifras.sesionesGrupales],
    ['Cobertura del seguimiento semanal', `${reporte.cifras.coberturaSemanalPct} % (${reporte.cifras.semanasReportadas} de ${reporte.cifras.semanasEsperadas} semanas)`],
    [],
    ['Código', 'Estrategia', 'Entidad', 'Territorio', 'Tutores', 'Estado del periodo', 'Estudiantes', 'Docentes acompañados', 'Docentes asignados', 'Acompañamientos individuales', 'Sesiones grupales', 'Semanas reportadas', 'Semanas esperadas', 'Registro oportuno %', 'Patrón del registro'],
    ...reporte.estrategias.map((e) => [
      e.codigo, e.nombre, e.entidadNombre, e.territorio, e.tutores.map((t) => t.nombre).join(' / '),
      e.periodo.estado === 'CERRADO' ? (e.periodo.extemporaneo ? 'Cerrado (extemporáneo)' : 'Cerrado') : 'Abierto',
      e.vinculados, e.docentesAcompanados, e.docentesAsignados, e.acompanamientosIndividuales, e.sesionesGrupales,
      e.semanasReportadas, e.semanasEsperadas, e.oportunidadPct, e.patron,
    ]),
    [],
    ['Tutor', 'Estrategias', 'Acompañamientos registrados', 'Semanas reportadas', 'Semanas exigibles', 'Registro oportuno %', 'Patrón del registro', 'Periodos cerrados', 'Cierres extemporáneos'],
    ...reporte.tutores.map((t) => [
      t.nombre, t.estrategias, t.acompanamientos, t.semanasReportadas, t.semanasExigibles, t.oportunidadPct, t.patron, t.periodosCerrados, t.cierresExtemporaneos,
    ]),
  ];
  // BOM para que Excel abra el archivo con tildes.
  return '﻿' + lineas.map((l) => l.map(csv).join(';')).join('\r\n') + '\r\n';
}
