import { Router } from 'express';
import { z } from 'zod';
import { contextoDe, ipDe } from './contexto';
import { pool } from './db';
import { AppError, asincrono, entero } from './errores';
import { autenticar, reglasDeSesion, requierePerfil } from './middleware/auth';
import { CAUSAS_INACTIVIDAD, MODALIDADES, MOTIVOS_DESVINCULACION, hoy } from './domain/reglas';
import { nombreDelMes } from './domain/semanas';
import {
  acompanamientosDelPeriodo,
  docentesDelPeriodo,
  esquemaAcompanamiento,
  esquemaAcompanamientoGrupal,
  registrarAcompanamiento,
  registrarAcompanamientoGrupal,
} from './modules/acompanamiento/acompanamiento.servicio';
import { consultarAuditoria, registrarAuditoria } from './modules/auditoria/auditoria.servicio';
import { TipoCarga, cargar, esquemaCarga, historialDeCargas, plantilla } from './modules/cargas/cargas.servicio';
import {
  cerrarPeriodo,
  esquemaCierre,
  esquemaDecisionReapertura,
  esquemaReapertura,
  listarReaperturas,
  resolverReapertura,
  resumenDeCierre,
  solicitarReapertura,
} from './modules/cierre/cierre.servicio';
import {
  crearEstrategia,
  detalleEstrategia,
  esquemaDecision,
  esquemaEstrategia,
  esquemaModificacion,
  esquemaSolicitud,
  exigirEstrategia,
  listarEstrategias,
  listarSolicitudesModificacion,
  modificarEstrategia,
  radicarSolicitud,
  resolverSolicitudModificacion,
} from './modules/estrategias/estrategias.servicio';
import {
  detalleDeSesion,
  esquemaCierreSesion,
  esquemaIncidente,
  esquemaRetraso,
  esquemaSesion,
  estadoDeOperacion,
  finalizarSesion,
  iniciarSesion as iniciarSesionPilotaje,
  listarSesiones,
  programarSesion,
  registrarIncidente,
  registrarRetraso,
  resolverIncidente,
  verificarSesion,
} from './modules/monitoreo/monitoreo.servicio';
import { crearObservacion, esquemaObservacion, listarObservaciones, marcarLeida, observacionesSinLeer } from './modules/observaciones/observaciones.servicio';
import { estadosDePeriodos, mesesDeEstrategia, estadoDe } from './modules/periodos/periodos.servicio';
import {
  certificarReporte,
  esquemaCertificacion,
  listarCertificados,
  previsualizarReporteDeLey,
  reporteDeControl,
  reporteEnCsv,
  verificarCertificado,
} from './modules/reportes/reportes.servicio';
import { cambiarContrasena, esquemaCambioContrasena, iniciarSesion, POLITICA_CONTRASENA } from './modules/seguridad/seguridad.servicio';
import { esquemaSeguimiento, registrarSeguimiento, semanasDelPeriodo } from './modules/seguimiento/seguimiento.servicio';
import { consultarTablero, detalleDeEstrategia } from './modules/tablero/tablero.servicio';
import {
  actualizarUsuario,
  candidatosDeReasignacion,
  crearUsuario,
  desbloquearUsuario,
  entidadesConCarga,
  esquemaActualizacion,
  esquemaRevocacion,
  esquemaUsuario,
  listarUsuarios,
  reactivarUsuario,
  restablecerContrasena,
  revocarUsuario,
} from './modules/usuarios/usuarios.servicio';
import {
  buscarCandidatos,
  desvincularEstudiante,
  esquemaDesvinculacion,
  listarVinculados,
  vincularEstudiantes,
} from './modules/vinculacion/vinculacion.servicio';

export const rutas = Router();

const opcional = (valor: unknown) => (valor === undefined || valor === '' ? undefined : entero(valor, 'filtro'));
const texto = (valor: unknown) => (typeof valor === 'string' && valor.trim() ? valor.trim() : undefined);
const mesActual = () => hoy().split('-').map(Number) as [number, number];

/** Perfiles que operan sobre el registro misional. El ente de control lo consulta, sin escribir. */
const MISIONALES = ['TUTOR', 'TUTOR_LIDER', 'ENTE_CONTROL'] as const;

// ------------------------------------------------------------------ Seguridad y acceso (CU-01)

rutas.get('/salud', asincrono(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ estado: 'ok', hoy: hoy() });
}));

const esquemaLogin = z.object({ correo: z.string().trim().min(1), contrasena: z.string().min(1) });

rutas.post('/auth/login', asincrono(async (req, res) => {
  const { correo, contrasena } = esquemaLogin.parse(req.body);
  res.json(await iniciarSesion(correo, contrasena, ipDe(req)));
}));

// Todo lo que sigue exige sesión vigente.
rutas.use(autenticar, reglasDeSesion);

rutas.get('/auth/yo', asincrono(async (req, res) => {
  res.json({ usuario: contextoDe(req).usuario, hoy: hoy(), politicaContrasena: POLITICA_CONTRASENA });
}));

rutas.post('/auth/cambiar-contrasena', asincrono(async (req, res) => {
  res.json(await cambiarContrasena(contextoDe(req), esquemaCambioContrasena.parse(req.body)));
}));

rutas.post('/auth/salir', asincrono(async (req, res) => {
  await registrarAuditoria(pool, contextoDe(req), { operacion: 'CERRAR_SESION', entidadAfectada: 'USUARIO', registroId: contextoDe(req).usuario.id, detalle: 'Cierre de sesión' });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ Catálogos precargados

rutas.get('/catalogos/listas', asincrono(async (_req, res) => {
  res.json({
    modalidades: MODALIDADES,
    causasInactividad: CAUSAS_INACTIVIDAD,
    motivosDesvinculacion: MOTIVOS_DESVINCULACION,
    politicaContrasena: POLITICA_CONTRASENA,
    hoy: hoy(),
  });
}));

/** Entidades del ámbito del usuario: es la única fuente para asociar una estrategia (RQ_003). */
rutas.get('/catalogos/entidades', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  const ctx = contextoDe(req);
  const { rows } = await pool.query(
    `SELECT id, codigo, nombre, municipio, territorio FROM entidad
      WHERE $2 OR id = ANY($1::int[]) ORDER BY territorio, nombre`,
    [ctx.usuario.entidades, ctx.usuario.perfil === 'ENTE_CONTROL'],
  );
  res.json(rows);
}));

rutas.get('/catalogos/entidades/:id/docentes', requierePerfil('TUTOR', 'TUTOR_LIDER'), asincrono(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, area, documento FROM docente WHERE entidad_id = $1 AND $1 = ANY($2::int[]) ORDER BY nombre`,
    [entero(req.params.id, 'id'), contextoDe(req).usuario.entidades],
  );
  res.json(rows);
}));

/** Usuarios con perfil de tutor habilitados para la entidad (CU-02). */
rutas.get('/catalogos/entidades/:id/tutores', requierePerfil('TUTOR', 'TUTOR_LIDER'), asincrono(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.nombre, u.correo
       FROM usuario u JOIN ambito_usuario a ON a.usuario_id = u.id
      WHERE a.entidad_id = $1 AND $1 = ANY($2::int[]) AND u.perfil = 'TUTOR' AND u.estado = 'ACTIVO'
      ORDER BY u.nombre`,
    [entero(req.params.id, 'id'), contextoDe(req).usuario.entidades],
  );
  res.json(rows);
}));

/** Tutores visibles: para el tutor líder, los de su territorio; para el ente de control, todos. */
rutas.get('/catalogos/tutores', requierePerfil('TUTOR_LIDER', 'ENTE_CONTROL'), asincrono(async (req, res) => {
  const ctx = contextoDe(req);
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.nombre
       FROM usuario u JOIN ambito_usuario a ON a.usuario_id = u.id
      WHERE u.perfil = 'TUTOR' AND ($2 OR a.entidad_id = ANY($1::int[]))
      ORDER BY u.nombre`,
    [ctx.usuario.entidades, ctx.usuario.perfil === 'ENTE_CONTROL'],
  );
  res.json(rows);
}));

rutas.get('/catalogos/territorios', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  const ctx = contextoDe(req);
  const { rows } = await pool.query(
    `SELECT DISTINCT territorio FROM entidad WHERE $2 OR id = ANY($1::int[]) ORDER BY territorio`,
    [ctx.usuario.entidades, ctx.usuario.perfil === 'ENTE_CONTROL'],
  );
  res.json(rows.map((r) => r.territorio));
}));

// ------------------------------------------------------------------ Estrategias (CU-02, CU-03, CU-04)

rutas.get('/estrategias', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  res.json(
    await listarEstrategias(contextoDe(req), {
      entidadId: opcional(req.query.entidadId),
      estado: texto(req.query.estado),
      q: texto(req.query.q),
    }),
  );
}));

rutas.post('/estrategias', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.status(201).json(await crearEstrategia(contextoDe(req), esquemaEstrategia.parse(req.body)));
}));

rutas.get('/estrategias/:id', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  res.json(await detalleEstrategia(contextoDe(req), entero(req.params.id, 'id')));
}));

rutas.put('/estrategias/:id', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.json(await modificarEstrategia(contextoDe(req), entero(req.params.id, 'id'), esquemaModificacion.parse(req.body)));
}));

rutas.post('/estrategias/:id/solicitudes-modificacion', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.status(201).json(await radicarSolicitud(contextoDe(req), entero(req.params.id, 'id'), esquemaSolicitud.parse(req.body)));
}));

/** El tutor líder decide las solicitudes de modificación de las estrategias de su territorio. */
rutas.get('/solicitudes-modificacion', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  res.json(await listarSolicitudesModificacion(contextoDe(req)));
}));

rutas.post('/solicitudes-modificacion/:id/decision', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  res.json(await resolverSolicitudModificacion(contextoDe(req), entero(req.params.id, 'id'), esquemaDecision.parse(req.body)));
}));

// ------------------------------------------------------------------ Vinculación (CU-05, CU-06)
// No existe ninguna ruta para crear estudiantes: el Piloto solo vincula los precargados (RQ_005).

rutas.get('/estrategias/:id/candidatos', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  const tamano = Math.min(opcional(req.query.tamano) ?? 25, 200);
  res.json(
    await buscarCandidatos(contextoDe(req), entero(req.params.id, 'id'), {
      q: texto(req.query.q),
      grado: texto(req.query.grado),
      pagina: opcional(req.query.pagina) ?? 1,
      tamano,
    }),
  );
}));

rutas.get('/estrategias/:id/vinculaciones', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  res.json(await listarVinculados(contextoDe(req), entero(req.params.id, 'id')));
}));

const esquemaVinculacion = z.object({ estudianteIds: z.array(z.number().int().positive()).min(1).max(500) });

rutas.post('/estrategias/:id/vinculaciones', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  const { estudianteIds } = esquemaVinculacion.parse(req.body);
  res.status(201).json(await vincularEstudiantes(contextoDe(req), entero(req.params.id, 'id'), estudianteIds));
}));

rutas.post('/estrategias/:id/vinculaciones/:vid/desvincular', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.json(
    await desvincularEstudiante(contextoDe(req), entero(req.params.id, 'id'), entero(req.params.vid, 'vid'), esquemaDesvinculacion.parse(req.body)),
  );
}));

// ------------------------------------------------------------------ Periodos mensuales y cierre (CU-10)

rutas.get('/estrategias/:id/periodos', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  const estrategia = await exigirEstrategia(pool, contextoDe(req), entero(req.params.id, 'id'));
  const fechaHoy = hoy();
  const [anioHoy, mesHoy] = mesActual();
  const estados = await estadosDePeriodos(pool, [estrategia.id]);
  res.json(
    mesesDeEstrategia(estrategia, fechaHoy)
      .map((m) => {
        const p = estadoDe(estados, estrategia.id, m.anio, m.mes);
        return {
          ...m,
          nombre: nombreDelMes(m.anio, m.mes),
          enCurso: m.anio === anioHoy && m.mes === mesHoy,
          estado: p.estado,
          corregido: p.corregido,
          reaperturaPendiente: p.reaperturaPendiente,
        };
      })
      .reverse(),
  );
}));

rutas.get('/estrategias/:id/periodos/:anio/:mes/cierre', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  res.json(await resumenDeCierre(contextoDe(req), entero(req.params.id, 'id'), entero(req.params.anio, 'anio'), entero(req.params.mes, 'mes')));
}));

rutas.post('/estrategias/:id/periodos/:anio/:mes/cierre', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.json(
    await cerrarPeriodo(contextoDe(req), entero(req.params.id, 'id'), entero(req.params.anio, 'anio'), entero(req.params.mes, 'mes'), esquemaCierre.parse(req.body ?? {})),
  );
}));

rutas.post('/estrategias/:id/periodos/:anio/:mes/reapertura', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.status(201).json(
    await solicitarReapertura(contextoDe(req), entero(req.params.id, 'id'), entero(req.params.anio, 'anio'), entero(req.params.mes, 'mes'), esquemaReapertura.parse(req.body)),
  );
}));

rutas.get('/reaperturas', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  res.json(await listarReaperturas(contextoDe(req)));
}));

rutas.post('/reaperturas/:id/decision', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  res.json(await resolverReapertura(contextoDe(req), entero(req.params.id, 'id'), esquemaDecisionReapertura.parse(req.body)));
}));

// ------------------------------------------------------------------ Acompañamiento (CU-07, CU-08)
// Lo registra el tutor que acompañó a los docentes; el tutor líder lo consulta (ver CORRECCIONES-PROPUESTA.md).

rutas.get('/estrategias/:id/periodos/:anio/:mes/docentes', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  res.json(
    await docentesDelPeriodo(contextoDe(req), entero(req.params.id, 'id'), entero(req.params.anio, 'anio'), entero(req.params.mes, 'mes')),
  );
}));

rutas.get('/estrategias/:id/periodos/:anio/:mes/acompanamientos', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  const id = entero(req.params.id, 'id');
  await exigirEstrategia(pool, contextoDe(req), id);
  res.json(await acompanamientosDelPeriodo(id, entero(req.params.anio, 'anio'), entero(req.params.mes, 'mes')));
}));

rutas.post('/estrategias/:id/acompanamientos', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.status(201).json(
    await registrarAcompanamiento(contextoDe(req), entero(req.params.id, 'id'), esquemaAcompanamiento.parse(req.body)),
  );
}));

rutas.post('/estrategias/:id/acompanamientos/grupales', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.status(201).json(
    await registrarAcompanamientoGrupal(contextoDe(req), entero(req.params.id, 'id'), esquemaAcompanamientoGrupal.parse(req.body)),
  );
}));

// ------------------------------------------------------------------ Seguimiento semanal (CU-09)

rutas.get('/estrategias/:id/periodos/:anio/:mes/semanas', requierePerfil(...MISIONALES), asincrono(async (req, res) => {
  res.json(
    await semanasDelPeriodo(contextoDe(req), entero(req.params.id, 'id'), entero(req.params.anio, 'anio'), entero(req.params.mes, 'mes')),
  );
}));

rutas.put('/estrategias/:id/seguimientos/:anioIso/:semanaIso', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.json(
    await registrarSeguimiento(
      contextoDe(req),
      entero(req.params.id, 'id'),
      entero(req.params.anioIso, 'anioIso'),
      entero(req.params.semanaIso, 'semanaIso'),
      esquemaSeguimiento.parse(req.body),
    ),
  );
}));

// ------------------------------------------------------------------ Tablero de cumplimiento (CU-11)

function filtrosDeConsulta(query: Record<string, unknown>) {
  const [anioHoy, mesHoy] = mesActual();
  return {
    anio: opcional(query.anio) ?? anioHoy,
    mes: opcional(query.mes) ?? mesHoy,
    entidadId: opcional(query.entidadId),
    estrategiaId: opcional(query.estrategiaId),
    tutorId: opcional(query.tutorId),
    territorio: texto(query.territorio),
  };
}

rutas.get('/tablero', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  res.json(await consultarTablero(contextoDe(req), filtrosDeConsulta(req.query)));
}));

rutas.get('/tablero/estrategias/:id/:anio/:mes', requierePerfil('TUTOR_LIDER', 'ENTE_CONTROL'), asincrono(async (req, res) => {
  const ctx = contextoDe(req);
  const detalle = await detalleDeEstrategia(ctx, entero(req.params.id, 'id'), entero(req.params.anio, 'anio'), entero(req.params.mes, 'mes'));
  if (ctx.usuario.perfil === 'ENTE_CONTROL') {
    await registrarAuditoria(pool, ctx, {
      operacion: 'CONSULTA_CONTROL',
      entidadAfectada: 'ESTRATEGIA',
      registroId: detalle.estrategia.id,
      valoresNuevos: { filtros: { estrategiaId: detalle.estrategia.id, anio: req.params.anio, mes: req.params.mes } },
      detalle: `Descenso al detalle de ${detalle.estrategia.codigo} (${detalle.periodo.nombre}) con su trazabilidad`,
    });
  }
  res.json(detalle);
}));

// ------------------------------------------------------------------ Observaciones al tutor (CU-11)

rutas.get('/observaciones', requierePerfil('TUTOR', 'TUTOR_LIDER'), asincrono(async (req, res) => {
  res.json(await listarObservaciones(contextoDe(req)));
}));

rutas.get('/observaciones/sin-leer', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.json({ sinLeer: await observacionesSinLeer(contextoDe(req)) });
}));

rutas.post('/observaciones', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  res.status(201).json(await crearObservacion(contextoDe(req), esquemaObservacion.parse(req.body)));
}));

rutas.post('/observaciones/:id/leida', requierePerfil('TUTOR'), asincrono(async (req, res) => {
  res.json(await marcarLeida(contextoDe(req), entero(req.params.id, 'id')));
}));

// ------------------------------------------------------------------ Reportes de ley (CU-12)

rutas.get('/reportes/ley', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  const f = filtrosDeConsulta(req.query);
  const excluir = texto(req.query.excluir)?.split(',').map((x) => entero(x, 'excluir')) ?? [];
  res.json(await previsualizarReporteDeLey(contextoDe(req), { anio: f.anio, mes: f.mes, territorio: f.territorio, excluir }));
}));

rutas.get('/reportes/ley/descarga', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  const ctx = contextoDe(req);
  const f = filtrosDeConsulta(req.query);
  const reporte = await previsualizarReporteDeLey(ctx, { anio: f.anio, mes: f.mes, territorio: f.territorio });
  await registrarAuditoria(pool, ctx, {
    operacion: 'DESCARGA_REPORTE_PRELIMINAR',
    entidadAfectada: 'REPORTE_DE_LEY',
    valoresNuevos: { filtros: f },
    detalle: `Descarga preliminar (no oficial) del reporte de ${reporte.periodo.nombre}`,
  });
  enviarCsv(res, `reporte-preliminar-${f.anio}-${String(f.mes).padStart(2, '0')}.csv`, reporteEnCsv('Reporte de ley SSES - PRELIMINAR, NO OFICIAL', reporte));
}));

rutas.post('/reportes/ley/certificar', requierePerfil('TUTOR_LIDER'), asincrono(async (req, res) => {
  res.status(201).json(await certificarReporte(contextoDe(req), esquemaCertificacion.parse(req.body)));
}));

rutas.get('/reportes/certificados', requierePerfil('TUTOR_LIDER', 'ENTE_CONTROL'), asincrono(async (_req, res) => {
  res.json(await listarCertificados());
}));

rutas.get('/reportes/verificar/:codigo', requierePerfil('TUTOR_LIDER', 'ENTE_CONTROL'), asincrono(async (req, res) => {
  res.json(await verificarCertificado(contextoDe(req), req.params.codigo));
}));

// ------------------------------------------------------------------ Reportes de control (CU-13)
// Solo lectura: cualquier verbo de escritura del ente de control lo rechaza `reglasDeSesion` (RN-08).

rutas.get('/control/reporte', requierePerfil('ENTE_CONTROL'), asincrono(async (req, res) => {
  res.json(await reporteDeControl(contextoDe(req), filtrosDeConsulta(req.query)));
}));

rutas.get('/control/reporte/descarga', requierePerfil('ENTE_CONTROL'), asincrono(async (req, res) => {
  const ctx = contextoDe(req);
  const f = filtrosDeConsulta(req.query);
  const reporte = await reporteDeControl(ctx, f);
  await registrarAuditoria(pool, ctx, {
    operacion: 'DESCARGA_CONTROL',
    entidadAfectada: 'REPORTE_DE_CONTROL',
    valoresNuevos: { filtros: f, estado: reporte.certificacion.estado },
    detalle: `Descarga del reporte de control de ${reporte.periodo.nombre} (${reporte.certificacion.estado === 'CERTIFICADO' ? `certificado v${reporte.certificacion.version}` : 'preliminar'})`,
  });
  const titulo = reporte.certificacion.estado === 'CERTIFICADO' ? 'Reporte de control SSES - CERTIFICADO' : 'Reporte de control SSES - PRELIMINAR, NO OFICIAL';
  enviarCsv(res, `reporte-control-${f.anio}-${String(f.mes).padStart(2, '0')}.csv`, reporteEnCsv(titulo, reporte));
}));

function enviarCsv(res: Parameters<Parameters<typeof rutas.get>[1]>[1], nombre: string, contenido: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(contenido);
}

// ------------------------------------------------------------------ Administración (CU-14)

rutas.get('/auditoria', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.json(
    await consultarAuditoria({
      operacion: texto(req.query.operacion),
      q: texto(req.query.q),
      pagina: opcional(req.query.pagina) ?? 1,
      tamano: Math.min(opcional(req.query.tamano) ?? 25, 100),
    }),
  );
}));

rutas.get('/usuarios', requierePerfil('ADMIN'), asincrono(async (_req, res) => {
  res.json(await listarUsuarios());
}));

rutas.post('/usuarios', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.status(201).json(await crearUsuario(contextoDe(req), esquemaUsuario.parse(req.body)));
}));

rutas.put('/usuarios/:id', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.json(await actualizarUsuario(contextoDe(req), entero(req.params.id, 'id'), esquemaActualizacion.parse(req.body)));
}));

rutas.get('/usuarios/:id/reasignacion', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.json(await candidatosDeReasignacion(entero(req.params.id, 'id')));
}));

rutas.post('/usuarios/:id/revocar', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.json(await revocarUsuario(contextoDe(req), entero(req.params.id, 'id'), esquemaRevocacion.parse(req.body)));
}));

rutas.post('/usuarios/:id/reactivar', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.json(await reactivarUsuario(contextoDe(req), entero(req.params.id, 'id')));
}));

rutas.post('/usuarios/:id/restablecer', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.json(await restablecerContrasena(contextoDe(req), entero(req.params.id, 'id')));
}));

rutas.post('/usuarios/:id/desbloquear', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.json(await desbloquearUsuario(contextoDe(req), entero(req.params.id, 'id')));
}));

rutas.get('/admin/entidades', requierePerfil('ADMIN'), asincrono(async (_req, res) => {
  res.json(await entidadesConCarga());
}));

const TIPOS_CARGA: Record<string, TipoCarga> = { entidades: 'ENTIDADES', estudiantes: 'ESTUDIANTES', docentes: 'DOCENTES' };
const tipoDeCarga = (valor: string): TipoCarga => {
  const tipo = TIPOS_CARGA[valor];
  if (!tipo) throw new AppError(404, 'TIPO_DE_CARGA_INVALIDO', 'El tipo de carga no existe. Use entidades, estudiantes o docentes.');
  return tipo;
};

rutas.get('/cargas', requierePerfil('ADMIN'), asincrono(async (_req, res) => {
  res.json(await historialDeCargas());
}));

rutas.get('/cargas/:tipo/plantilla', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  const tipo = tipoDeCarga(req.params.tipo);
  enviarCsv(res, `plantilla-${req.params.tipo}.csv`, plantilla(tipo));
}));

rutas.post('/cargas/:tipo', requierePerfil('ADMIN'), asincrono(async (req, res) => {
  res.status(201).json(await cargar(contextoDe(req), tipoDeCarga(req.params.tipo), esquemaCarga.parse(req.body)));
}));

// ------------------------------------------------------------------ Monitoreo del pilotaje (CU-15)

rutas.get('/monitoreo/estado', requierePerfil('SOPORTE'), asincrono(async (_req, res) => {
  res.json(await estadoDeOperacion());
}));

rutas.get('/monitoreo/sesiones', requierePerfil('SOPORTE'), asincrono(async (_req, res) => {
  res.json(await listarSesiones());
}));

rutas.post('/monitoreo/sesiones', requierePerfil('SOPORTE'), asincrono(async (req, res) => {
  res.status(201).json(await programarSesion(contextoDe(req), esquemaSesion.parse(req.body)));
}));

rutas.get('/monitoreo/sesiones/:id', requierePerfil('SOPORTE'), asincrono(async (req, res) => {
  res.json(await detalleDeSesion(entero(req.params.id, 'id')));
}));

rutas.post('/monitoreo/sesiones/:id/verificacion', requierePerfil('SOPORTE'), asincrono(async (req, res) => {
  res.json(await verificarSesion(contextoDe(req), entero(req.params.id, 'id')));
}));

rutas.post('/monitoreo/sesiones/:id/inicio', requierePerfil('SOPORTE'), asincrono(async (req, res) => {
  res.json(await iniciarSesionPilotaje(contextoDe(req), entero(req.params.id, 'id')));
}));

rutas.post('/monitoreo/sesiones/:id/retraso', requierePerfil('SOPORTE'), asincrono(async (req, res) => {
  res.json(await registrarRetraso(contextoDe(req), entero(req.params.id, 'id'), esquemaRetraso.parse(req.body)));
}));

rutas.post('/monitoreo/sesiones/:id/incidentes', requierePerfil('SOPORTE'), asincrono(async (req, res) => {
  res.status(201).json(await registrarIncidente(contextoDe(req), entero(req.params.id, 'id'), esquemaIncidente.parse(req.body)));
}));

rutas.post('/monitoreo/sesiones/:id/incidentes/:iid/resolucion', requierePerfil('SOPORTE'), asincrono(async (req, res) => {
  res.json(await resolverIncidente(contextoDe(req), entero(req.params.id, 'id'), entero(req.params.iid, 'iid')));
}));

rutas.post('/monitoreo/sesiones/:id/cierre', requierePerfil('SOPORTE'), asincrono(async (req, res) => {
  res.json(await finalizarSesion(contextoDe(req), entero(req.params.id, 'id'), esquemaCierreSesion.parse(req.body ?? {})));
}));
