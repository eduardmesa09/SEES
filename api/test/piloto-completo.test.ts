/**
 * Pruebas de las funciones que completan el Piloto más allá del núcleo del MVP:
 * acompañamiento grupal, desvinculación, cierre y reapertura, solicitudes de modificación,
 * reportes de ley, ente de control, administración de usuarios, cargas masivas y monitoreo.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { pool } from '../src/db';
import { hoy } from '../src/domain/reglas';
import { rangoDelMes, semanasDelMes, sumarDias } from '../src/domain/semanas';
import { CONTRASENA_DEMO } from '../src/seed';

const app = crearApp();

async function iniciar(correo: string, contrasena = CONTRASENA_DEMO) {
  const respuesta = await request(app).post('/api/auth/login').send({ correo, contrasena });
  expect(respuesta.status).toBe(200);
  return respuesta.body.token as string;
}

const con = (token: string) => ({
  get: (ruta: string) => request(app).get(`/api${ruta}`).set('Authorization', `Bearer ${token}`),
  post: (ruta: string, cuerpo: unknown = {}) => request(app).post(`/api${ruta}`).set('Authorization', `Bearer ${token}`).send(cuerpo as object),
  put: (ruta: string, cuerpo: unknown) => request(app).put(`/api${ruta}`).set('Authorization', `Bearer ${token}`).send(cuerpo as object),
});

const fechaHoy = hoy();
const [anioHoy, mesHoy] = fechaHoy.split('-').map(Number);
const previo = mesHoy === 1 ? { anio: anioHoy - 1, mes: 12 } : { anio: anioHoy, mes: mesHoy - 1 };
const rangoPrevio = rangoDelMes(previo.anio, previo.mes);
const semanasPrevias = semanasDelMes(previo.anio, previo.mes);

let tutor1: string, tutor2: string, tutor3: string, lider: string, admin: string, control: string, soporte: string;
let entidadId: number;
let docentes: { id: number }[];

async function crearEstrategia(nombre: string, cantidadDocentes = 3) {
  const respuesta = await con(tutor1).post('/estrategias', {
    entidadId,
    nombre,
    objetivo: 'Fortalecer las competencias de los estudiantes mediante trabajo por proyectos.',
    modalidad: 'PRESENCIAL',
    fechaInicio: rangoPrevio.inicio,
    fechaFin: sumarDias(fechaHoy, 60),
    cupoMaximo: 10,
    tutorIds: [],
    docenteIds: docentes.slice(0, cantidadDocentes).map((d) => d.id),
  });
  expect(respuesta.status).toBe(201);
  return respuesta.body as { id: number; codigo: string };
}

async function vincular(estrategiaId: number, cantidad: number) {
  const candidatos = await con(tutor1).get(`/estrategias/${estrategiaId}/candidatos?tamano=${cantidad}`);
  const ids = candidatos.body.estudiantes.map((e: { id: number }) => e.id);
  const respuesta = await con(tutor1).post(`/estrategias/${estrategiaId}/vinculaciones`, { estudianteIds: ids });
  expect(respuesta.status).toBe(201);
}

beforeAll(async () => {
  [tutor1, tutor2, tutor3, lider, admin, control, soporte] = await Promise.all(
    ['tutor1', 'tutor2', 'tutor3', 'lider', 'admin', 'control', 'soporte'].map((c) => iniciar(`${c}@sses.test`)),
  );
  const entidades = await con(tutor1).get('/catalogos/entidades');
  entidadId = entidades.body[1].id;
  docentes = (await con(tutor1).get(`/catalogos/entidades/${entidadId}/docentes`)).body;
});

afterAll(async () => {
  await pool.end();
});

describe('Acompañamiento: lo registra el tutor (corrección de actores)', () => {
  it('el tutor líder no puede registrar acompañamientos; el tutor de la estrategia sí', async () => {
    const estrategia = await crearEstrategia('Taller de Escritura Creativa');
    const cuerpo = {
      ...previo, docenteId: docentes[0].id, fecha: sumarDias(rangoPrevio.inicio, 5), modalidad: 'PRESENCIAL',
      tema: 'Escritura de cuento corto', observaciones: 'Observación de aula y retroalimentación.', compromisos: 'Aplicar la guía de revisión.',
    };
    const delLider = await con(lider).post(`/estrategias/${estrategia.id}/acompanamientos`, cuerpo);
    expect(delLider.status).toBe(403);
    const delTutor = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos`, cuerpo);
    expect(delTutor.status).toBe(201);
    expect(delTutor.body.registradoPor).toBe('Camila Torres Rincón');
  });
});

describe('Acompañamiento grupal (CU-08, RQ_008)', () => {
  let estrategia: { id: number };
  const sesion = (extra: Record<string, unknown> = {}) => ({
    ...previo, docenteIds: docentes.slice(0, 3).map((d) => d.id), fecha: sumarDias(rangoPrevio.inicio, 11), modalidad: 'PRESENCIAL',
    tema: 'Taller colectivo de evaluación', observaciones: 'Jornada de trabajo con los docentes de la estrategia.', compromisos: 'Unificar la rúbrica.',
    ...extra,
  });

  beforeAll(async () => {
    estrategia = await crearEstrategia('Semillero de Astronomía');
  });

  it('exige al menos dos asistentes', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos/grupales`, sesion({ docenteIds: [docentes[0].id] }));
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.codigo).toBe('MINIMO_DOS_ASISTENTES');
  });

  it('genera en una transacción un acompañamiento por asistente, agrupados en la misma sesión', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos/grupales`, sesion());
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.registros).toBe(3);
    const filas = await pool.query(`SELECT DISTINCT sesion_grupal_id, tipo FROM acompanamiento WHERE estrategia_id = $1`, [estrategia.id]);
    expect(filas.rows).toEqual([{ sesion_grupal_id: respuesta.body.sesionId, tipo: 'GRUPAL' }]);
  });

  it('advierte otra sesión grupal el mismo día para los mismos docentes y permite confirmarla', async () => {
    const repetida = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos/grupales`, sesion());
    expect(repetida.status).toBe(409);
    expect(repetida.body.codigo).toBe('SESION_GRUPAL_EXISTENTE');
    const confirmada = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos/grupales`, sesion({ confirmarCoincidencia: true }));
    expect(confirmada.status).toBe(201);
  });
});

describe('Desvinculación de estudiantes (CU-06, RQ_006)', () => {
  let estrategia: { id: number };
  let vinculaciones: { id: number; fechaVinculacion: string }[];

  beforeAll(async () => {
    estrategia = await crearEstrategia('Banda Marcial Escolar');
    await vincular(estrategia.id, 2);
    vinculaciones = (await con(tutor1).get(`/estrategias/${estrategia.id}/vinculaciones`)).body;
  });

  const ruta = (id: number) => `/estrategias/${estrategia.id}/vinculaciones/${id}/desvincular`;

  it('exige un motivo de la lista y rechaza fechas anteriores a la vinculación o futuras', async () => {
    expect((await con(tutor1).post(ruta(vinculaciones[0].id), { fecha: fechaHoy })).status).toBe(400);
    const anterior = await con(tutor1).post(ruta(vinculaciones[0].id), { motivo: 'Traslado a otra institución', fecha: sumarDias(fechaHoy, -40) });
    expect(anterior.body.codigo).toBe('FECHA_ANTERIOR_A_VINCULACION');
    const futura = await con(tutor1).post(ruta(vinculaciones[0].id), { motivo: 'Traslado a otra institución', fecha: sumarDias(fechaHoy, 1) });
    expect(futura.body.codigo).toBe('FECHA_FUTURA');
  });

  it('desvincula de forma lógica, libera el cupo y conserva la historia', async () => {
    const respuesta = await con(tutor1).post(ruta(vinculaciones[0].id), { motivo: 'Traslado a otra institución', fecha: fechaHoy });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({ vinculados: 1, estadoEstrategia: 'BLOQUEADA', desbloqueada: false });
    const fila = await pool.query(`SELECT estado, motivo_desvinculacion FROM vinculacion_estudiante WHERE id = $1`, [vinculaciones[0].id]);
    expect(fila.rows[0]).toEqual({ estado: 'INACTIVA', motivo_desvinculacion: 'Traslado a otra institución' });
  });

  it('si la estrategia queda sin participantes activos vuelve a ser editable', async () => {
    const respuesta = await con(tutor1).post(ruta(vinculaciones[1].id), { motivo: 'Retiro voluntario del estudiante', fecha: fechaHoy });
    expect(respuesta.body).toMatchObject({ vinculados: 0, estadoEstrategia: 'EDITABLE', desbloqueada: true });
    expect((await con(tutor1).get(`/estrategias/${estrategia.id}`)).body.estado).toBe('EDITABLE');
  });
});

describe('Cierre y reapertura del periodo mensual (CU-10, RQ_010)', () => {
  let estrategia: { id: number };
  const base = () => `/estrategias/${estrategia.id}/periodos/${previo.anio}/${previo.mes}`;

  beforeAll(async () => {
    estrategia = await crearEstrategia('Escuela de Danza Folclórica', 2);
  });

  it('impide cerrar un periodo sin ningún registro', async () => {
    const respuesta = await con(tutor1).post(`${base()}/cierre`, {});
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.codigo).toBe('PERIODO_VACIO');
  });

  it('impide cerrar el mes que aún está en curso', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/periodos/${anioHoy}/${mesHoy}/cierre`, {});
    expect(respuesta.body.codigo).toBe('PERIODO_EN_CURSO');
  });

  it('PF-17 · con semanas faltantes permite el cierre solo con justificación', async () => {
    await con(tutor1).put(`/estrategias/${estrategia.id}/seguimientos/${semanasPrevias[0].anioIso}/${semanasPrevias[0].semanaIso}`, {
      ...previo, sinActividad: false, actividades: 'Ensayo general con el grupo.',
    });
    const resumen = await con(tutor1).get(`${base()}/cierre`);
    expect(resumen.body.resumen).toMatchObject({ semanasReportadas: 1, completo: false });

    const sinJustificar = await con(tutor1).post(`${base()}/cierre`, {});
    expect(sinJustificar.status).toBe(400);
    expect(sinJustificar.body.codigo).toBe('JUSTIFICACION_REQUERIDA');

    const cerrado = await con(tutor1).post(`${base()}/cierre`, { justificacion: 'Las demás semanas no tuvieron ensayos por la temporada de lluvias.' });
    expect(cerrado.status).toBe(200);
    expect(cerrado.body.estado).toBe('CERRADO');
    expect(cerrado.body.extemporaneo).toBe(fechaHoy > sumarDias(rangoPrevio.fin, 5));
  });

  it('el periodo cerrado no admite registros ni ediciones', async () => {
    const respuesta = await con(tutor1).put(`/estrategias/${estrategia.id}/seguimientos/${semanasPrevias[1].anioIso}/${semanasPrevias[1].semanaIso}`, {
      ...previo, sinActividad: false, actividades: 'Intento después del cierre.',
    });
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.codigo).toBe('PERIODO_CERRADO');
  });

  it('la reapertura la decide el tutor líder, conserva la versión cerrada y marca el periodo como corregido', async () => {
    expect((await con(tutor1).post(`${base()}/reapertura`, { motivo: 'corto' })).status).toBe(400);
    const solicitud = await con(tutor1).post(`${base()}/reapertura`, { motivo: 'Faltó registrar la segunda semana, que sí tuvo ensayo.' });
    expect(solicitud.status).toBe(201);
    expect((await con(tutor1).post(`/reaperturas/${solicitud.body.id}/decision`, { aprobar: true, respuesta: 'Aprobada.' })).status).toBe(403);

    const aprobada = await con(lider).post(`/reaperturas/${solicitud.body.id}/decision`, { aprobar: true, respuesta: 'Se aprueba para corregir la semana faltante.' });
    expect(aprobada.status).toBe(200);
    const periodos = await con(tutor1).get(`/estrategias/${estrategia.id}/periodos`);
    expect(periodos.body.find((p: { mes: number }) => p.mes === previo.mes)).toMatchObject({ estado: 'ABIERTO', corregido: true });
    const version = await pool.query(
      `SELECT v.datos->>'estado' AS estado FROM periodo_version v JOIN periodo_mensual p ON p.id = v.periodo_id WHERE p.estrategia_id = $1`,
      [estrategia.id],
    );
    expect(version.rows).toEqual([{ estado: 'CERRADO' }]);
  });
});

describe('Solicitudes de modificación (CU-03)', () => {
  it('aprobada por el tutor líder, habilita una única edición de la estrategia bloqueada', async () => {
    const estrategia = await crearEstrategia('Club de Debate Juvenil', 2);
    await vincular(estrategia.id, 1);
    const detalle = await con(tutor1).get(`/estrategias/${estrategia.id}`);
    const cuerpo = {
      nombre: detalle.body.nombre, objetivo: detalle.body.objetivo, modalidad: detalle.body.modalidad, fechaInicio: detalle.body.fechaInicio,
      fechaFin: detalle.body.fechaFin, cupoMaximo: 15, tutorIds: [], docenteIds: detalle.body.docentes.map((d: { id: number }) => d.id),
    };
    expect((await con(tutor1).put(`/estrategias/${estrategia.id}`, { ...cuerpo, version: detalle.body.version })).status).toBe(403);

    const solicitud = await con(tutor1).post(`/estrategias/${estrategia.id}/solicitudes-modificacion`, {
      cambiosSolicitados: 'Ampliar el cupo a 15', justificacion: 'Hay estudiantes en lista de espera.',
    });
    expect(solicitud.status).toBe(201);
    const pendientes = await con(lider).get('/solicitudes-modificacion');
    const id = pendientes.body.find((s: { estrategiaId: number }) => s.estrategiaId === estrategia.id).id;
    expect((await con(lider).post(`/solicitudes-modificacion/${id}/decision`, { aprobar: true, respuesta: 'Aprobada la ampliación.' })).status).toBe(200);

    const editada = await con(tutor1).put(`/estrategias/${estrategia.id}`, { ...cuerpo, version: detalle.body.version });
    expect(editada.status).toBe(200);
    expect(editada.body).toMatchObject({ cupoMaximo: 15, estado: 'BLOQUEADA', edicionAutorizada: false });
    const otra = await con(tutor1).put(`/estrategias/${estrategia.id}`, { ...cuerpo, cupoMaximo: 20, version: editada.body.version });
    expect(otra.status).toBe(403);
  });
});

describe('Reportes de ley y ente de control (CU-12, CU-13, RQ_012, RQ_013)', () => {
  let codigo: string;

  it('RN-09 · no certifica mientras haya periodos abiertos e informa qué tutores los tienen', async () => {
    const vista = await con(lider).get(`/reportes/ley?anio=${previo.anio}&mes=${previo.mes}&territorio=Caribe`);
    expect(vista.status).toBe(200);
    expect(vista.body.certificable).toBe(false);
    expect(vista.body.pendientes[0].tutores).toContain('Luisa Fernanda Castro Peña');
    const certificar = await con(lider).post('/reportes/ley/certificar', { ...previo, territorio: 'Caribe' });
    expect(certificar.status).toBe(409);
    expect(certificar.body.codigo).toBe('PERIODOS_ABIERTOS');
  });

  it('certifica y congela el reporte con su identificador de verificación', async () => {
    const lectura = (await con(tutor3).get('/estrategias')).body.find((e: { nombre: string }) => e.nombre === 'Club de Lectura Crítica');
    const cierre = await con(tutor3).post(`/estrategias/${lectura.id}/periodos/${previo.anio}/${previo.mes}/cierre`, {
      justificacion: 'Un docente estuvo en licencia y no pudo acompañarse durante el mes.',
    });
    expect(cierre.status).toBe(200);

    const certificado = await con(lider).post('/reportes/ley/certificar', { ...previo, territorio: 'Caribe' });
    expect(certificado.status).toBe(201);
    expect(certificado.body.version).toBe(1);
    codigo = certificado.body.codigoVerificacion;
    expect(codigo).toMatch(/^SSES-[0-9A-F]{12}$/);
    await expect(pool.query(`UPDATE reporte_certificado SET alcance = 'otro'`)).rejects.toThrow(/solo anexado/);
  });

  it('una recertificación exige justificación y crea una nueva versión sin sobrescribir la anterior', async () => {
    const sinMotivo = await con(lider).post('/reportes/ley/certificar', { ...previo, territorio: 'Caribe' });
    expect(sinMotivo.body.codigo).toBe('CERTIFICACION_PREVIA');
    const nueva = await con(lider).post('/reportes/ley/certificar', { ...previo, territorio: 'Caribe', motivoAjuste: 'Ajuste por corrección de la cobertura reportada.' });
    expect(nueva.body.version).toBe(2);
    const versiones = await pool.query(`SELECT version FROM reporte_certificado WHERE alcance = 'Caribe' ORDER BY version`);
    expect(versiones.rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it('el ente de control ve la versión vigente, sabe que existe una anterior y su consulta queda auditada', async () => {
    const reporte = await con(control).get(`/control/reporte?anio=${previo.anio}&mes=${previo.mes}&territorio=Caribe`);
    expect(reporte.status).toBe(200);
    expect(reporte.body.certificacion).toMatchObject({ estado: 'CERTIFICADO', version: 2 });
    expect(reporte.body.certificacion.anteriores).toHaveLength(1);

    const andina = await con(control).get(`/control/reporte?anio=${previo.anio}&mes=${previo.mes}&territorio=Andina`);
    expect(andina.body.certificacion.estado).toBe('PRELIMINAR');

    const descarga = await con(control).get(`/control/reporte/descarga?anio=${previo.anio}&mes=${previo.mes}&territorio=Andina`);
    expect(descarga.headers['content-type']).toMatch(/text\/csv/);
    expect(descarga.text).toContain('PRELIMINAR - NO OFICIAL');

    const traza = await pool.query(`SELECT operacion FROM auditoria WHERE usuario_correo = 'control@sses.test' AND operacion IN ('CONSULTA_CONTROL', 'DESCARGA_CONTROL')`);
    expect(new Set(traza.rows.map((r) => r.operacion))).toEqual(new Set(['CONSULTA_CONTROL', 'DESCARGA_CONTROL']));
    expect((await con(control).get(`/reportes/verificar/${codigo}`)).body.vigente).toBe(false);
  });

  it('RN-08 · el ente de control consulta todo pero cualquier escritura se rechaza y se audita', async () => {
    const estrategias = await con(control).get('/estrategias');
    expect(estrategias.status).toBe(200);
    expect(estrategias.body.length).toBeGreaterThan(3);
    const escritura = await con(control).put(`/estrategias/${estrategias.body[0].id}`, {});
    expect(escritura.status).toBe(403);
    expect((await con(control).post('/estrategias', {})).status).toBe(403);
    const traza = await pool.query(`SELECT 1 FROM auditoria WHERE usuario_correo = 'control@sses.test' AND operacion = 'ACCESO_DENEGADO'`);
    expect(traza.rowCount).toBeGreaterThanOrEqual(2);
  });
});

describe('Ciclo de vida de los usuarios (CU-14, RQ_015)', () => {
  let nuevoId: number;
  let temporal: string;
  const datos = { documento: '1077123456', nombre: 'Julián Andrés Pardo Ríos', correo: 'julian.pardo@sses.test', perfil: 'TUTOR' };

  it('crea el usuario con credenciales de activación y no permite duplicarlo', async () => {
    const respuesta = await con(admin).post('/usuarios', { ...datos, entidadIds: [entidadId] });
    expect(respuesta.status).toBe(201);
    nuevoId = respuesta.body.id;
    temporal = respuesta.body.contrasenaTemporal;
    const repetido = await con(admin).post('/usuarios', { ...datos, entidadIds: [entidadId] });
    expect(repetido.body.codigo).toBe('USUARIO_EXISTENTE');
    expect((await con(admin).post('/usuarios', { ...datos, documento: '1077999999', correo: 'otro@sses.test', entidadIds: [] })).body.codigo).toBe('AMBITO_REQUERIDO');
  });

  it('CU-01 · en el primer ingreso obliga a definir una contraseña que cumpla la política', async () => {
    const token = await iniciar(datos.correo, temporal);
    const bloqueado = await con(token).get('/estrategias');
    expect(bloqueado.body.codigo).toBe('CAMBIO_DE_CONTRASENA_REQUERIDO');
    expect((await con(token).post('/auth/cambiar-contrasena', { actual: temporal, nueva: 'sencilla' })).body.codigo).toBe('CONTRASENA_DEBIL');
    const cambio = await con(token).post('/auth/cambiar-contrasena', { actual: temporal, nueva: 'Nueva#Clave2026' });
    expect(cambio.status).toBe(200);
    expect((await con(cambio.body.token).get('/estrategias')).status).toBe(200);
  });

  it('no inactiva a un tutor con estrategias sin reasignarlas, y al revocar cierra sus sesiones', async () => {
    const token = await iniciar(datos.correo, 'Nueva#Clave2026');
    const estrategia = await con(token).post('/estrategias', {
      entidadId, nombre: 'Estrategia del tutor que se retira', objetivo: 'Objetivo pedagógico de la estrategia de prueba.',
      modalidad: 'VIRTUAL', fechaInicio: fechaHoy, fechaFin: sumarDias(fechaHoy, 30), cupoMaximo: 5, tutorIds: [], docenteIds: [docentes[0].id],
    });
    expect(estrategia.status).toBe(201);

    const sinReasignar = await con(admin).post(`/usuarios/${nuevoId}/revocar`, { motivo: 'Terminó su participación en el pilotaje' });
    expect(sinReasignar.status).toBe(409);
    expect(sinReasignar.body.codigo).toBe('TUTOR_CON_ESTRATEGIAS');

    const tutorCamila = (await pool.query(`SELECT id FROM usuario WHERE correo = 'tutor1@sses.test'`)).rows[0].id;
    const revocado = await con(admin).post(`/usuarios/${nuevoId}/revocar`, {
      motivo: 'Terminó su participación en el pilotaje',
      reasignaciones: [{ estrategiaId: estrategia.body.id, tutorId: tutorCamila }],
    });
    expect(revocado.status).toBe(200);
    expect((await con(token).get('/estrategias')).body.codigo).toBe('SESION_REVOCADA');
    const reingreso = await request(app).post('/api/auth/login').send({ correo: datos.correo, contrasena: 'Nueva#Clave2026' });
    expect(reingreso.body.codigo).toBe('ACCESO_REVOCADO');
    expect((await con(tutor1).get(`/estrategias/${estrategia.body.id}`)).status).toBe(200);
  });
});

describe('Carga masiva (CU-14, RQ_014)', () => {
  it('rechaza completo un archivo que no corresponde a la plantilla', async () => {
    const respuesta = await con(admin).post('/cargas/docentes', { archivo: 'mal.csv', contenido: 'documento,nombre\n123,Ana' });
    expect(respuesta.status).toBe(400);
    expect(respuesta.body).toMatchObject({ codigo: 'PLANTILLA_INVALIDA', faltan: ['area', 'codigo_entidad'] });
  });

  it('informa los documentos repetidos y, consolidados, carga los válidos con el motivo de cada rechazo', async () => {
    const contenido = [
      'documento;nombre;area;codigo_entidad',
      '52990001;Ana María Duarte;Matemáticas;IE-1101',
      '52990001;Ana María Duarte;Matemáticas;IE-1101',
      '52990002;Pedro Nel Ospina;Lenguaje;IE-0000',
      '52990003;;Lenguaje;IE-1101',
    ].join('\n');
    const repetidos = await con(admin).post('/cargas/docentes', { archivo: 'docentes.csv', contenido });
    expect(repetidos.body.codigo).toBe('DOCUMENTOS_REPETIDOS');
    const carga = await con(admin).post('/cargas/docentes', { archivo: 'docentes.csv', contenido, consolidarDuplicados: true });
    expect(carga.status).toBe(201);
    expect(carga.body).toMatchObject({ filas: 4, aceptados: 1, rechazados: 2, consolidados: 1 });
    expect(carga.body.rechazos.map((r: { fila: number }) => r.fila)).toEqual([4, 5]);
    expect(carga.body.rechazos[0].motivo).toMatch(/IE-0000 no existe/);
  });
});

describe('Monitoreo de las sesiones del pilotaje (CU-15, RQ_016)', () => {
  it('solo el ingeniero de soporte accede a la consola', async () => {
    expect((await con(soporte).get('/monitoreo/estado')).status).toBe(200);
    expect((await con(admin).get('/monitoreo/estado')).status).toBe(403);
    expect((await con(soporte).get('/estrategias')).status).toBe(403);
  });

  it('exige la verificación previa, registra incidentes y genera el reporte técnico', async () => {
    const sesion = await con(soporte).post('/monitoreo/sesiones', { nombre: 'Sesión de prueba con tutores de la región Andina' });
    const id = sesion.body.id;
    expect((await con(soporte).post(`/monitoreo/sesiones/${id}/inicio`)).body.codigo).toBe('SIN_VERIFICACION');
    expect((await con(soporte).post(`/monitoreo/sesiones/${id}/verificacion`)).body.todosDisponibles).toBe(true);
    expect((await con(soporte).post(`/monitoreo/sesiones/${id}/inicio`)).status).toBe(200);

    const incidente = await con(soporte).post(`/monitoreo/sesiones/${id}/incidentes`, {
      usuarioAfectado: 'tutor1@sses.test', region: 'Andina', descripcion: 'La página tardó en cargar el seguimiento.',
      accion: 'Se recargó la sesión del navegador.', completoRegistro: true,
    });
    expect(incidente.status).toBe(201);
    expect((await con(soporte).post(`/monitoreo/sesiones/${id}/incidentes/${incidente.body.id}/resolucion`)).status).toBe(200);

    const cierre = await con(soporte).post(`/monitoreo/sesiones/${id}/cierre`, {});
    expect(cierre.status).toBe(200);
    expect(cierre.body.reporte.incidentes).toMatchObject({ total: 1, resueltos: 1 });
  });
});

describe('Observaciones del tutor líder (CU-11)', () => {
  it('la observación llega al tutor y queda registrada con su autor', async () => {
    const tutorAndres = (await pool.query(`SELECT id FROM usuario WHERE correo = 'tutor2@sses.test'`)).rows[0].id;
    const creada = await con(lider).post('/observaciones', { tutorId: tutorAndres, ...previo, texto: 'La cuarta semana de la Huerta quedó sin reporte.' });
    expect(creada.status).toBe(201);
    expect((await con(tutor2).get('/observaciones/sin-leer')).body.sinLeer).toBe(1);
    const lista = await con(tutor2).get('/observaciones');
    expect(lista.body[0]).toMatchObject({ autor: 'Marta Lucía Gómez Herrera' });
    await con(tutor2).post(`/observaciones/${lista.body[0].id}/leida`);
    expect((await con(tutor2).get('/observaciones/sin-leer')).body.sinLeer).toBe(0);
    expect((await con(tutor3).post('/observaciones', { tutorId: tutorAndres, ...previo, texto: 'Un tutor no puede observar.' })).status).toBe(403);
  });
});
