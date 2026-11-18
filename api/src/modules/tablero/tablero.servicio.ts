import { Contexto } from '../../contexto';
import { pool } from '../../db';
import { porcentaje } from '../../domain/cobertura';
import { Patron, RegistroEvaluado, evaluarAcompanamiento, evaluarSeguimiento, patronDeRegistro } from '../../domain/oportunidad';
import { fechaLocal, hoy } from '../../domain/reglas';
import { nombreDelMes, rangoDelMes } from '../../domain/semanas';
import { acompanamientosDelPeriodo } from '../acompanamiento/acompanamiento.servicio';
import { exigirEstrategia, predicadoDeAmbito } from '../estrategias/estrategias.servicio';
import { estadoDe, estadoDelPeriodo, estadosDePeriodos, semanasEsperadas, semanasExigibles, validarPeriodo } from '../periodos/periodos.servicio';
import { estadoSemanal } from '../seguimiento/seguimiento.servicio';
import { docentesDeEstrategia } from '../vinculacion/vinculacion.servicio';

export interface FiltrosTablero {
  anio: number;
  mes: number;
  entidadId?: number;
  estrategiaId?: number;
  tutorId?: number;
  territorio?: string;
}

interface FilaEstrategia {
  id: number;
  codigo: string;
  nombre: string;
  estado: string;
  fechaInicio: string;
  fechaFin: string;
  cupoMaximo: number;
  entidadId: number;
  entidadNombre: string;
  territorio: string;
  vinculados: number;
  docentesAsignados: number;
  tutores: { id: number; nombre: string }[];
}

/**
 * CU-11 / RQ_011: indicadores de cumplimiento y desempeño por estrategia y por tutor.
 * Traslada la evaluación desde lo que el tutor dice que hizo hacia lo que quedó registrado y cuándo.
 */
export async function consultarTablero(ctx: Contexto, filtros: FiltrosTablero) {
  const { anio, mes } = filtros;
  const rango = rangoDelMes(anio, mes);
  const fechaHoy = hoy();

  // Estrategias dentro del ámbito del usuario cuya vigencia se cruza con el mes consultado.
  const params: unknown[] = [];
  const condiciones = [predicadoDeAmbito(ctx, params)];
  params.push(rango.fin, rango.inicio);
  condiciones.push(`e.fecha_inicio <= $${params.length - 1} AND e.fecha_fin >= $${params.length}`);
  if (filtros.entidadId) {
    params.push(filtros.entidadId);
    condiciones.push(`e.entidad_id = $${params.length}`);
  }
  if (filtros.estrategiaId) {
    params.push(filtros.estrategiaId);
    condiciones.push(`e.id = $${params.length}`);
  }
  if (filtros.territorio) {
    params.push(filtros.territorio);
    condiciones.push(`en.territorio = $${params.length}`);
  }
  if (filtros.tutorId) {
    params.push(filtros.tutorId);
    condiciones.push(
      `EXISTS (SELECT 1 FROM estrategia_tutor ft WHERE ft.estrategia_id = e.id AND ft.usuario_id = $${params.length})`,
    );
  }

  const { rows } = await pool.query(
    `SELECT e.id, e.codigo, e.nombre, e.estado, e.fecha_inicio AS "fechaInicio", e.fecha_fin AS "fechaFin",
            e.cupo_maximo AS "cupoMaximo", e.entidad_id AS "entidadId", en.nombre AS "entidadNombre", en.territorio,
            (SELECT count(*) FROM vinculacion_estudiante v WHERE v.estrategia_id = e.id AND v.estado = 'ACTIVA')::int AS vinculados,
            (SELECT count(*) FROM estrategia_docente ed WHERE ed.estrategia_id = e.id)::int AS "docentesAsignados",
            (SELECT coalesce(json_agg(json_build_object('id', u.id, 'nombre', u.nombre) ORDER BY u.nombre), '[]'::json)
               FROM estrategia_tutor et JOIN usuario u ON u.id = et.usuario_id
              WHERE et.estrategia_id = e.id) AS tutores
       FROM estrategia e JOIN entidad en ON en.id = e.entidad_id
      WHERE ${condiciones.join(' AND ')}
      ORDER BY en.territorio, en.nombre, e.nombre`,
    params,
  );
  const estrategias = rows as FilaEstrategia[];
  const ids = estrategias.map((e) => e.id);

  const [seguimientos, acompanamientos] = await Promise.all([
    pool.query(
      `SELECT s.estrategia_id AS "estrategiaId", s.inicio_semana AS "inicioSemana", s.fin_semana AS "finSemana",
              s.sin_actividad AS "sinActividad", s.registrado_en AS "registradoEn"
         FROM seguimiento_semanal s
        WHERE s.estrategia_id = ANY($1::int[]) AND s.inicio_semana BETWEEN $2 AND $3`,
      [ids, rango.inicio, rango.fin],
    ),
    pool.query(
      `SELECT a.estrategia_id AS "estrategiaId", a.docente_id AS "docenteId", a.fecha, a.registrado_en AS "registradoEn",
              a.tipo, a.sesion_grupal_id AS "sesionGrupalId", a.registrado_por AS "registradoPor"
         FROM acompanamiento a JOIN periodo_mensual p ON p.id = a.periodo_id
        WHERE a.estrategia_id = ANY($1::int[]) AND p.anio = $2 AND p.mes = $3`,
      [ids, anio, mes],
    ),
  ]);
  const periodos = await estadosDePeriodos(pool, ids);

  const registrosPorEstrategia = new Map<number, RegistroEvaluado[]>();

  const filas = estrategias.map((e) => {
    const esperadas = semanasEsperadas(e, anio, mes);
    const inicios = new Set(esperadas.map((s) => s.inicio));

    const segs = seguimientos.rows.filter((s) => s.estrategiaId === e.id && inicios.has(s.inicioSemana));
    const reportadas = new Set(segs.map((s) => s.inicioSemana as string));
    // Exigibles: las semanas que ya terminaron, más la que esté en curso si ya fue reportada.
    const terminadas = new Set(semanasExigibles(e, anio, mes, fechaHoy).map((s) => s.inicio));
    const exigibles = esperadas.filter((s) => terminadas.has(s.inicio) || reportadas.has(s.inicio));

    const evaluados = segs
      .map((s) => {
        const fechaRegistro = fechaLocal(s.registradoEn as Date);
        return {
          inicioSemana: s.inicioSemana as string,
          finSemana: s.finSemana as string,
          sinActividad: s.sinActividad as boolean,
          fechaRegistro,
          ...evaluarSeguimiento(s.finSemana as string, fechaRegistro),
        };
      })
      .sort((a, b) => a.inicioSemana.localeCompare(b.inicioSemana));
    registrosPorEstrategia.set(e.id, evaluados);

    const acomps = acompanamientos.rows.filter((a) => a.estrategiaId === e.id);
    const acompOportunos = acomps.filter(
      (a) => evaluarAcompanamiento(a.fecha as string, fechaLocal(a.registradoEn as Date)).oportuno,
    ).length;
    const docentesAcompanados = new Set(acomps.map((a) => a.docenteId as number)).size;
    const oportunos = evaluados.filter((r) => r.oportuno).length;
    const periodo = estadoDe(periodos, e.id, anio, mes);

    return {
      id: e.id,
      codigo: e.codigo,
      nombre: e.nombre,
      estado: e.estado,
      entidadId: e.entidadId,
      entidadNombre: e.entidadNombre,
      territorio: e.territorio,
      tutores: e.tutores,
      vinculados: e.vinculados,
      cupoMaximo: e.cupoMaximo,
      docentesAsignados: e.docentesAsignados,
      docentesAcompanados,
      coberturaDocentesPct: porcentaje(docentesAcompanados, e.docentesAsignados),
      acompanamientos: acomps.length,
      acompanamientosIndividuales: acomps.filter((a) => a.tipo === 'INDIVIDUAL').length,
      sesionesGrupales: new Set(acomps.filter((a) => a.sesionGrupalId).map((a) => a.sesionGrupalId as number)).size,
      acompanamientosOportunos: acompOportunos,
      // Quién registró cada acompañamiento: el desempeño se atribuye a su autor.
      autores: acomps.map((a) => a.registradoPor as number),
      periodo: {
        estado: periodo.estado,
        cerradoEn: periodo.cerradoEn,
        cerradoPor: periodo.cerradoPor,
        extemporaneo: periodo.extemporaneo,
        corregido: periodo.corregido,
        justificacion: periodo.justificacionCierre,
      },
      semanasEsperadas: esperadas.length,
      semanasExigibles: exigibles.length,
      semanasReportadas: segs.length,
      semanasSinActividad: segs.filter((s) => s.sinActividad).length,
      coberturaSemanalPct: porcentaje(segs.length, exigibles.length),
      registrosOportunos: oportunos,
      registrosTardios: evaluados.length - oportunos,
      oportunidadPct: porcentaje(oportunos, evaluados.length),
      patron: patronDeRegistro(evaluados, rango.fin) as Patron,
      // Cuándo se hizo cada registro semanal: es la evidencia de la distribución temporal.
      semanas: esperadas.map((s) => ({ ...s, registro: evaluados.find((r) => r.inicioSemana === s.inicio) ?? null })),
    };
  });

  // Consolidado por tutor: lo que debía reportar frente a lo que reportó, y cómo lo distribuyó en el tiempo.
  const porTutor = new Map<number, {
    id: number; nombre: string; estrategias: number; semanasExigibles: number; semanasReportadas: number;
    docentesAsignados: number; docentesAcompanados: number; registros: RegistroEvaluado[];
    acompanamientos: number; sesionesGrupales: number; periodosCerrados: number; cierresExtemporaneos: number;
  }>();
  for (const fila of filas) {
    for (const tutor of fila.tutores) {
      const acumulado = porTutor.get(tutor.id) ?? {
        id: tutor.id, nombre: tutor.nombre, estrategias: 0, semanasExigibles: 0, semanasReportadas: 0,
        docentesAsignados: 0, docentesAcompanados: 0, registros: [],
        acompanamientos: 0, sesionesGrupales: 0, periodosCerrados: 0, cierresExtemporaneos: 0,
      };
      acumulado.estrategias += 1;
      acumulado.semanasExigibles += fila.semanasExigibles;
      acumulado.semanasReportadas += fila.semanasReportadas;
      acumulado.docentesAsignados += fila.docentesAsignados;
      acumulado.docentesAcompanados += fila.docentesAcompanados;
      acumulado.registros.push(...(registrosPorEstrategia.get(fila.id) ?? []));
      acumulado.acompanamientos += fila.autores.filter((autor) => autor === tutor.id).length;
      acumulado.sesionesGrupales += fila.sesionesGrupales;
      if (fila.periodo.estado === 'CERRADO') acumulado.periodosCerrados += 1;
      if (fila.periodo.estado === 'CERRADO' && fila.periodo.extemporaneo) acumulado.cierresExtemporaneos += 1;
      porTutor.set(tutor.id, acumulado);
    }
  }
  const tutores = [...porTutor.values()]
    .map(({ registros, ...t }) => {
      const oportunos = registros.filter((r) => r.oportuno).length;
      return {
        ...t,
        coberturaSemanalPct: porcentaje(t.semanasReportadas, t.semanasExigibles),
        coberturaDocentesPct: porcentaje(t.docentesAcompanados, t.docentesAsignados),
        registrosOportunos: oportunos,
        registrosTardios: registros.length - oportunos,
        oportunidadPct: porcentaje(oportunos, registros.length),
        patron: patronDeRegistro(registros, rango.fin) as Patron,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const suma = (campo: keyof (typeof filas)[number]) => filas.reduce((total, f) => total + (f[campo] as number), 0);
  const totalRegistros = suma('registrosOportunos') + suma('registrosTardios');
  const cerradas = filas.filter((f) => f.periodo.estado === 'CERRADO').length;
  // Solo es definitivo lo que está cerrado: si queda algún periodo abierto, todo el resultado es preliminar (RQ_011).
  const preliminar = cerradas < filas.length || filas.length === 0;

  return {
    periodo: {
      anio,
      mes,
      nombre: nombreDelMes(anio, mes),
      enCurso: rango.inicio <= fechaHoy && rango.fin >= fechaHoy,
      preliminar,
      periodosCerrados: cerradas,
      periodosAbiertos: filas.length - cerradas,
      advertencia: preliminar
        ? `Información preliminar: ${filas.length - cerradas} de ${filas.length} periodo(s) siguen abiertos y sus cifras aún pueden cambiar.`
        : 'Todos los periodos de la selección están cerrados.',
    },
    resumen: {
      estrategias: filas.length,
      estudiantesVinculados: suma('vinculados'),
      docentesAsignados: suma('docentesAsignados'),
      docentesAcompanados: suma('docentesAcompanados'),
      coberturaDocentesPct: porcentaje(suma('docentesAcompanados'), suma('docentesAsignados')),
      acompanamientos: suma('acompanamientos'),
      acompanamientosIndividuales: suma('acompanamientosIndividuales'),
      sesionesGrupales: suma('sesionesGrupales'),
      semanasExigibles: suma('semanasExigibles'),
      semanasReportadas: suma('semanasReportadas'),
      coberturaSemanalPct: porcentaje(suma('semanasReportadas'), suma('semanasExigibles')),
      oportunidadPct: porcentaje(suma('registrosOportunos'), totalRegistros),
    },
    estrategias: filas.map(({ autores: _autores, ...f }) => f),
    tutores,
  };
}

/** Descenso al detalle: los registros individuales que explican cada cifra, con su autor y su fecha. */
export async function detalleDeEstrategia(ctx: Contexto, estrategiaId: number, anio: number, mes: number) {
  const estrategia = await exigirEstrategia(pool, ctx, estrategiaId);
  validarPeriodo(estrategia, anio, mes);

  const [semanal, acompanamientos, docentes, periodo] = await Promise.all([
    estadoSemanal(pool, estrategia, anio, mes),
    acompanamientosDelPeriodo(estrategiaId, anio, mes),
    docentesDeEstrategia(pool, estrategiaId),
    estadoDelPeriodo(pool, estrategiaId, anio, mes),
  ]);
  const acompanados = new Set(acompanamientos.map((a) => a.docenteId));

  return {
    estrategia: {
      id: estrategia.id,
      codigo: estrategia.codigo,
      nombre: estrategia.nombre,
      entidadNombre: estrategia.entidadNombre,
      territorio: estrategia.territorio,
      estado: estrategia.estado,
      vinculados: estrategia.vinculados,
      cupoMaximo: estrategia.cupoMaximo,
    },
    periodo: { anio, mes, nombre: nombreDelMes(anio, mes), preliminar: periodo.estado !== 'CERRADO', ...periodo },
    semanas: semanal.semanas,
    cobertura: semanal.cobertura,
    acompanamientos,
    docentesSinAcompanamiento: docentes.filter((d) => !acompanados.has(d.id)),
  };
}
