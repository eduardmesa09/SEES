import { z } from 'zod';
import { Contexto } from '../../contexto';
import { enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { normalizar } from '../../domain/reglas';
import { registrarAuditoria } from '../auditoria/auditoria.servicio';

/**
 * CU-14 / RQ_014: carga masiva de entidades, estudiantes y docentes desde la plantilla definida.
 * - Un archivo que no corresponde a la plantilla se rechaza completo, sin procesar nada.
 * - Los documentos repetidos dentro del archivo se informan y pueden consolidarse en uno.
 * - Cada fila inválida se rechaza con su número y su motivo; las válidas se cargan en una transacción.
 */

export type TipoCarga = 'ENTIDADES' | 'ESTUDIANTES' | 'DOCENTES';

const TERRITORIOS = ['Andina', 'Caribe', 'Pacífica', 'Orinoquía', 'Amazonía', 'Insular'];
const TIPOS_DOCUMENTO = ['TI', 'CC', 'RC', 'CE', 'PPT', 'NUIP'];

const PLANTILLAS: Record<TipoCarga, { columnas: string[]; ejemplo: string[][]; clave: string }> = {
  ENTIDADES: {
    columnas: ['codigo', 'nombre', 'municipio', 'territorio'],
    ejemplo: [['IE-9101', 'Institución Educativa Selva de Florencia', 'Florencia', 'Amazonía']],
    clave: 'codigo',
  },
  ESTUDIANTES: {
    columnas: ['tipo_documento', 'documento', 'nombres', 'apellidos', 'grado', 'codigo_entidad'],
    ejemplo: [['TI', '1099000001', 'Sara Lucía', 'Ramírez Peña', '901', 'IE-1101']],
    clave: 'documento',
  },
  DOCENTES: {
    columnas: ['documento', 'nombre', 'area', 'codigo_entidad'],
    ejemplo: [['52999001', 'Jorge Iván Mesa Rueda', 'Matemáticas', 'IE-1101']],
    clave: 'documento',
  },
};

export const esquemaCarga = z.object({
  archivo: z.string().trim().min(1).max(200),
  contenido: z.string().min(1).max(5_000_000),
  consolidarDuplicados: z.boolean().optional(),
});

export function plantilla(tipo: TipoCarga): string {
  const p = PLANTILLAS[tipo];
  return [p.columnas.join(','), ...p.ejemplo.map((fila) => fila.join(','))].join('\r\n') + '\r\n';
}

/** Lector de CSV sencillo: admite coma o punto y coma, comillas dobles y BOM. */
export function leerCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const separador = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === separador) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

interface Rechazo { fila: number; documento: string; motivo: string }

export async function cargar(ctx: Contexto, tipo: TipoCarga, datos: z.infer<typeof esquemaCarga>) {
  const definicion = PLANTILLAS[tipo];
  const filas = leerCsv(datos.contenido);
  if (!filas.length) throw new AppError(400, 'ARCHIVO_VACIO', 'El archivo no tiene contenido.');

  // 1. Estructura: si no corresponde a la plantilla vigente se rechaza completo.
  const encabezado = filas[0].map((c) => normalizar(c).replace(/\s+/g, '_'));
  const faltan = definicion.columnas.filter((c) => !encabezado.includes(c));
  const sobran = encabezado.filter((c) => !definicion.columnas.includes(c));
  if (faltan.length || sobran.length) {
    await registrarAuditoria(pool, ctx, {
      operacion: 'CARGA_RECHAZADA',
      entidadAfectada: tipo,
      detalle: `Archivo ${datos.archivo} rechazado completo: no corresponde a la plantilla`,
    });
    throw new AppError(
      400,
      'PLANTILLA_INVALIDA',
      'El archivo no corresponde a la plantilla vigente y no se procesó ningún registro.',
      { faltan, sobran, esperadas: definicion.columnas },
    );
  }
  const indice = Object.fromEntries(definicion.columnas.map((c) => [c, encabezado.indexOf(c)]));
  const registros = filas.slice(1).map((f, i) => ({
    fila: i + 2,
    valores: Object.fromEntries(definicion.columnas.map((c) => [c, (f[indice[c]] ?? '').trim()])) as Record<string, string>,
  }));
  if (!registros.length) throw new AppError(400, 'ARCHIVO_VACIO', 'El archivo solo tiene el encabezado.');

  // 2. Documentos repetidos dentro del archivo: se informan y se pueden consolidar.
  const porClave = new Map<string, number[]>();
  for (const r of registros) {
    const clave = r.valores[definicion.clave].toUpperCase();
    if (!clave) continue;
    porClave.set(clave, [...(porClave.get(clave) ?? []), r.fila]);
  }
  const repetidos = [...porClave.entries()].filter(([, f]) => f.length > 1).map(([clave, f]) => ({ clave, filas: f }));
  if (repetidos.length && !datos.consolidarDuplicados) {
    throw new AppError(
      409,
      'DOCUMENTOS_REPETIDOS',
      `El archivo tiene ${repetidos.length} ${definicion.clave === 'codigo' ? 'código(s)' : 'documento(s)'} repetido(s). Puede consolidarlos en un único registro (se conserva la primera fila) y continuar.`,
      { repetidos },
    );
  }
  const vistos = new Set<string>();
  const consolidados: Rechazo[] = [];
  const unicos = registros.filter((r) => {
    const clave = r.valores[definicion.clave].toUpperCase();
    if (clave && vistos.has(clave)) {
      consolidados.push({ fila: r.fila, documento: clave, motivo: 'Consolidado con la primera aparición del mismo documento' });
      return false;
    }
    vistos.add(clave);
    return true;
  });

  // 3. Validación fila por fila contra las reglas y contra lo ya cargado.
  const entidades = await pool.query(`SELECT id, upper(codigo) AS codigo FROM entidad`);
  const entidadPorCodigo = new Map(entidades.rows.map((e) => [e.codigo as string, e.id as number]));
  const tabla = tipo === 'ENTIDADES' ? 'entidad' : tipo === 'ESTUDIANTES' ? 'estudiante' : 'docente';
  const columnaClave = tipo === 'ENTIDADES' ? 'codigo' : 'documento';
  const yaExisten = await pool.query(
    `SELECT upper(${columnaClave}) AS clave FROM ${tabla} WHERE upper(${columnaClave}) = ANY($1::text[])`,
    [unicos.map((r) => r.valores[definicion.clave].toUpperCase())],
  );
  const existentes = new Set(yaExisten.rows.map((r) => r.clave as string));

  const rechazos: Rechazo[] = [];
  const aceptados: { fila: number; valores: Record<string, string>; entidadId?: number }[] = [];
  for (const r of unicos) {
    const v = r.valores;
    const documento = v[definicion.clave];
    const rechazar = (motivo: string) => rechazos.push({ fila: r.fila, documento: documento || '(vacío)', motivo });
    const vacios = definicion.columnas.filter((c) => !v[c]);
    if (vacios.length) { rechazar(`Campos obligatorios vacíos: ${vacios.join(', ')}`); continue; }
    if (existentes.has(documento.toUpperCase())) { rechazar(`Ya existe un registro con ${columnaClave} ${documento}`); continue; }

    if (tipo === 'ENTIDADES') {
      if (!/^[A-Z]{2}-\d{3,6}$/i.test(documento)) { rechazar('Código con formato inválido (ejemplo: IE-1101)'); continue; }
      if (!TERRITORIOS.includes(v.territorio)) { rechazar(`Territorio no reconocido. Use: ${TERRITORIOS.join(', ')}`); continue; }
      aceptados.push({ fila: r.fila, valores: v });
      continue;
    }
    if (!/^\d{5,12}$/.test(documento)) { rechazar('El documento debe tener entre 5 y 12 dígitos'); continue; }
    const entidadId = entidadPorCodigo.get(v.codigo_entidad.toUpperCase());
    if (!entidadId) { rechazar(`La entidad ${v.codigo_entidad} no existe: el registro no puede asociarse`); continue; }
    if (tipo === 'ESTUDIANTES') {
      if (!TIPOS_DOCUMENTO.includes(v.tipo_documento.toUpperCase())) { rechazar(`Tipo de documento no reconocido. Use: ${TIPOS_DOCUMENTO.join(', ')}`); continue; }
      if (!/^(0|[1-9]|1[01])\d{2}$/.test(v.grado)) { rechazar('Grado inválido (ejemplo: 601, 1102)'); continue; }
    }
    aceptados.push({ fila: r.fila, valores: v, entidadId });
  }

  // 4. Inserción de los válidos en una sola transacción, con su informe.
  return enTransaccion(async (tx) => {
    for (const a of aceptados) {
      const v = a.valores;
      if (tipo === 'ENTIDADES') {
        await tx.query(`INSERT INTO entidad (codigo, nombre, municipio, territorio) VALUES ($1, $2, $3, $4)`, [
          v.codigo.toUpperCase(), v.nombre, v.municipio, v.territorio,
        ]);
      } else if (tipo === 'ESTUDIANTES') {
        await tx.query(
          `INSERT INTO estudiante (tipo_documento, documento, nombres, apellidos, nombre_busqueda, grado, entidad_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [v.tipo_documento.toUpperCase(), v.documento, v.nombres, v.apellidos, normalizar(`${v.nombres} ${v.apellidos}`), v.grado, a.entidadId],
        );
      } else {
        await tx.query(`INSERT INTO docente (documento, nombre, area, entidad_id) VALUES ($1, $2, $3, $4)`, [
          v.documento, v.nombre, v.area, a.entidadId,
        ]);
      }
    }
    const informe = { rechazos, consolidados, repetidos: repetidos.length };
    const { rows } = await tx.query(
      `INSERT INTO carga_masiva (tipo, archivo, filas, aceptados, rechazados, informe, cargado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, cargado_en AS "cargadoEn"`,
      [tipo, datos.archivo, registros.length, aceptados.length, rechazos.length, JSON.stringify(informe), ctx.usuario.id],
    );
    await registrarAuditoria(tx, ctx, {
      operacion: 'CARGA_MASIVA',
      entidadAfectada: tipo,
      registroId: rows[0].id,
      valoresNuevos: { archivo: datos.archivo, filas: registros.length, aceptados: aceptados.length, rechazados: rechazos.length, consolidados: consolidados.length },
      detalle: `Carga de ${tipo.toLowerCase()} desde ${datos.archivo}: ${aceptados.length} aceptado(s), ${rechazos.length} rechazado(s)`,
    });
    return {
      id: rows[0].id as number,
      tipo,
      archivo: datos.archivo,
      filas: registros.length,
      aceptados: aceptados.length,
      rechazados: rechazos.length,
      consolidados: consolidados.length,
      rechazos,
      cargadoEn: rows[0].cargadoEn,
    };
  });
}

export async function historialDeCargas() {
  const { rows } = await pool.query(
    `SELECT c.id, c.tipo, c.archivo, c.filas, c.aceptados, c.rechazados, c.informe, c.cargado_en AS "cargadoEn",
            u.nombre AS "cargadoPor"
       FROM carga_masiva c JOIN usuario u ON u.id = c.cargado_por
      ORDER BY c.id DESC LIMIT 50`,
  );
  return rows;
}
