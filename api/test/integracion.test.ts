/**
 * Pruebas de integración y funcionales sobre el API, contra PostgreSQL.
 * Cada caso lleva el identificador de la matriz de pruebas del numeral 2.9.4 de la propuesta.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { pool } from '../src/db';
import { hoy } from '../src/domain/reglas';
import { rangoDelMes, semanasDelMes, sumarDias } from '../src/domain/semanas';
import { CONTRASENA_DEMO } from '../src/seed';

const app = crearApp();

async function iniciar(clave: string) {
  const respuesta = await request(app).post('/api/auth/login').send({ correo: `${clave}@sses.test`, contrasena: CONTRASENA_DEMO });
  expect(respuesta.status).toBe(200);
  return respuesta.body.token as string;
}

const con = (token: string) => ({
  get: (ruta: string) => request(app).get(`/api${ruta}`).set('Authorization', `Bearer ${token}`),
  post: (ruta: string, cuerpo: unknown) => request(app).post(`/api${ruta}`).set('Authorization', `Bearer ${token}`).send(cuerpo as object),
  put: (ruta: string, cuerpo: unknown) => request(app).put(`/api${ruta}`).set('Authorization', `Bearer ${token}`).send(cuerpo as object),
});

// Calendario relativo: el mes anterior ya terminó y permite reportar todas sus semanas.
const fechaHoy = hoy();
const [anioHoy, mesHoy] = fechaHoy.split('-').map(Number);
const previo = mesHoy === 1 ? { anio: anioHoy - 1, mes: 12 } : { anio: anioHoy, mes: mesHoy - 1 };
const rangoPrevio = rangoDelMes(previo.anio, previo.mes);
const semanasPrevias = semanasDelMes(previo.anio, previo.mes);

let tutor1: string, tutor2: string, tutor3: string, lider: string, admin: string;
let entidadId: number;
let docentes: { id: number }[];
let docenteAjeno: number;

function datosEstrategia(nombre: string, extra: Record<string, unknown> = {}) {
  return {
    entidadId,
    nombre,
    objetivo: 'Fortalecer las competencias de los estudiantes mediante trabajo por proyectos.',
    modalidad: 'PRESENCIAL',
    fechaInicio: rangoPrevio.inicio,
    fechaFin: sumarDias(fechaHoy, 60),
    cupoMaximo: 10,
    tutorIds: [],
    docenteIds: docentes.slice(0, 2).map((d) => d.id),
    ...extra,
  };
}

async function crear(nombre: string, extra: Record<string, unknown> = {}) {
  const respuesta = await con(tutor1).post('/estrategias', datosEstrategia(nombre, extra));
  expect(respuesta.status).toBe(201);
  return respuesta.body as { id: number; codigo: string; estado: string; version: number };
}

async function candidatos(estrategiaId: number, cantidad: number) {
  const respuesta = await con(tutor1).get(`/estrategias/${estrategiaId}/candidatos?tamano=${cantidad}`);
  expect(respuesta.status).toBe(200);
  return (respuesta.body.estudiantes as { id: number }[]).map((e) => e.id);
}

beforeAll(async () => {
  [tutor1, tutor2, tutor3, lider, admin] = await Promise.all(['tutor1', 'tutor2', 'tutor3', 'lider', 'admin'].map(iniciar));
  const entidades = await con(tutor1).get('/catalogos/entidades');
  entidadId = entidades.body[1].id; // una entidad del ámbito de tutor1 sin estrategias sembradas
  docentes = (await con(tutor1).get(`/catalogos/entidades/${entidadId}/docentes`)).body;
  const ajenos = await pool.query('SELECT id FROM docente WHERE entidad_id <> $1 LIMIT 1', [entidadId]);
  docenteAjeno = ajenos.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Estrategias estudiantiles (CU-02, CU-03)', () => {
  it('PF-01 · crea la estrategia con datos válidos, en estado EDITABLE y con identificador único', async () => {
    const estrategia = await crear('Taller de Oratoria');
    expect(estrategia.estado).toBe('EDITABLE');
    expect(estrategia.codigo).toMatch(/^EST-\d{6}$/);
  });

  it('PU-01 · dos creaciones simultáneas generan identificadores distintos', async () => {
    const [a, b] = await Promise.all([crear('Grupo Concurrente A'), crear('Grupo Concurrente B')]);
    expect(a.codigo).not.toBe(b.codigo);
  });

  it('PU-03 · rechaza una fecha final anterior a la inicial, sin persistir nada', async () => {
    const antes = await pool.query('SELECT count(*) AS n FROM estrategia');
    const respuesta = await con(tutor1).post('/estrategias', datosEstrategia('Rango Inválido', { fechaFin: sumarDias(rangoPrevio.inicio, -30) }));
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.codigo).toBe('RANGO_DE_FECHAS_INVALIDO');
    const despues = await pool.query('SELECT count(*) AS n FROM estrategia');
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it('rechaza un cupo en cero y señala los campos obligatorios sin diligenciar', async () => {
    const cupo = await con(tutor1).post('/estrategias', datosEstrategia('Cupo Cero', { cupoMaximo: 0 }));
    expect(cupo.body.codigo).toBe('CUPO_INVALIDO');
    const vacio = await con(tutor1).post('/estrategias', { entidadId });
    expect(vacio.status).toBe(400);
    expect(Object.keys(vacio.body.campos)).toEqual(expect.arrayContaining(['nombre', 'objetivo', 'fechaInicio', 'cupoMaximo']));
  });

  it('PF-02 · advierte la estrategia duplicada por nombre y entidad, sin bloquear si se confirma', async () => {
    await crear('Círculo de Ciencias');
    const advertencia = await con(tutor1).post('/estrategias', datosEstrategia('  circulo de CIENCIAS '));
    expect(advertencia.status).toBe(409);
    expect(advertencia.body.codigo).toBe('ESTRATEGIA_DUPLICADA');
    expect(advertencia.body.existente.nombre).toBe('Círculo de Ciencias');

    const confirmada = await con(tutor1).post('/estrategias', datosEstrategia('circulo de CIENCIAS', { confirmarDuplicado: true }));
    expect(confirmada.status).toBe(201);
  });

  it('rechaza la creación en una entidad fuera del ámbito del tutor', async () => {
    const fuera = await pool.query(`SELECT id FROM entidad WHERE territorio = 'Pacífica' LIMIT 1`);
    const respuesta = await con(tutor1).post('/estrategias', datosEstrategia('Fuera de Ámbito', { entidadId: fuera.rows[0].id }));
    expect(respuesta.status).toBe(403);
    expect(respuesta.body.codigo).toBe('ENTIDAD_FUERA_DE_AMBITO');
  });

  it('PF-03 · permite editar mientras no haya vinculaciones y conserva la versión anterior', async () => {
    const estrategia = await crear('Coro Escolar');
    const edicion = await con(tutor1).put(`/estrategias/${estrategia.id}`, {
      ...datosEstrategia('Coro Escolar Juvenil', { cupoMaximo: 18 }),
      version: estrategia.version,
    });
    expect(edicion.status).toBe(200);
    expect(edicion.body).toMatchObject({ nombre: 'Coro Escolar Juvenil', cupoMaximo: 18, version: 2 });

    const detalle = await con(tutor1).get(`/estrategias/${estrategia.id}`);
    expect(detalle.body.versiones).toHaveLength(1);
    expect(detalle.body.versiones[0].datos).toMatchObject({ nombre: 'Coro Escolar', cupoMaximo: 10 });
  });

  it('detecta el conflicto cuando otro usuario modificó la misma estrategia', async () => {
    const estrategia = await crear('Club de Astronomía');
    const cuerpo = { ...datosEstrategia('Club de Astronomía'), version: estrategia.version };
    expect((await con(tutor1).put(`/estrategias/${estrategia.id}`, cuerpo)).status).toBe(200);
    const segundo = await con(tutor1).put(`/estrategias/${estrategia.id}`, cuerpo);
    expect(segundo.status).toBe(409);
    expect(segundo.body.codigo).toBe('CONFLICTO_DE_VERSION');
  });
});

describe('Vinculación de estudiantes y bloqueo de la estrategia (CU-05, RQ_004, RQ_005)', () => {
  let estrategia: { id: number; version: number };
  let estudiantes: number[];

  beforeAll(async () => {
    estrategia = await crear('Semillero de Periodismo');
    estudiantes = await candidatos(estrategia.id, 30);
  });

  it('PI-01 · una vinculación fallida no deja nada a medias: la estrategia sigue editable', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/vinculaciones`, { estudianteIds: [estudiantes[0], 99999999] });
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.codigo).toBe('ESTUDIANTE_NO_PRECARGADO');
    const estado = await pool.query(
      `SELECT e.estado, (SELECT count(*) FROM vinculacion_estudiante v WHERE v.estrategia_id = e.id) AS n FROM estrategia e WHERE e.id = $1`,
      [estrategia.id],
    );
    expect(estado.rows[0]).toMatchObject({ estado: 'EDITABLE', n: 0 });
  });

  it('PI-01 · la primera vinculación bloquea la estrategia en la misma transacción', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/vinculaciones`, { estudianteIds: estudiantes.slice(0, 4) });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toMatchObject({
      estadoAnterior: 'EDITABLE',
      estadoEstrategia: 'BLOQUEADA',
      bloqueoAplicado: true,
      totalVinculados: 4,
      cupoDisponible: 6,
    });
    const estado = await pool.query('SELECT estado, bloqueada_en FROM estrategia WHERE id = $1', [estrategia.id]);
    expect(estado.rows[0].estado).toBe('BLOQUEADA');
    expect(estado.rows[0].bloqueada_en).not.toBeNull();
  });

  it('PF-04 · rechaza en el servidor la edición de una estrategia bloqueada y registra el intento', async () => {
    const respuesta = await con(tutor1).put(`/estrategias/${estrategia.id}`, {
      ...datosEstrategia('Nombre Alterado', { cupoMaximo: 50 }),
      version: estrategia.version,
    });
    expect(respuesta.status).toBe(403);
    expect(respuesta.body.codigo).toBe('ESTRATEGIA_BLOQUEADA');

    const intacta = await pool.query('SELECT nombre, cupo_maximo FROM estrategia WHERE id = $1', [estrategia.id]);
    expect(intacta.rows[0]).toMatchObject({ nombre: 'Semillero de Periodismo', cupo_maximo: 10 });
    const traza = await pool.query(`SELECT 1 FROM auditoria WHERE operacion = 'EDICION_RECHAZADA' AND registro_id = $1`, [String(estrategia.id)]);
    expect(traza.rowCount).toBe(1);
  });

  it('la solicitud de modificación queda radicada sin alterar la estrategia', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/solicitudes-modificacion`, {
      cambiosSolicitados: 'Ampliar el cupo de 10 a 15 estudiantes',
      justificacion: 'La institución abrió un grupo adicional interesado en participar.',
    });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.estado).toBe('RADICADA');
    const detalle = await con(tutor1).get(`/estrategias/${estrategia.id}`);
    expect(detalle.body).toMatchObject({ cupoMaximo: 10, estado: 'BLOQUEADA' });
    expect(detalle.body.solicitudes).toHaveLength(1);
    // Con una solicitud en trámite no se radica otra: la decide el tutor líder.
    expect(detalle.body.permisos).toMatchObject({ editar: false, solicitarModificacion: false });
  });

  it('PF-06 · descarta al estudiante ya vinculado y continúa con el resto del lote', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/vinculaciones`, {
      estudianteIds: [estudiantes[0], estudiantes[1], estudiantes[4], estudiantes[5]],
    });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.descartados).toHaveLength(2);
    expect(respuesta.body.vinculados).toHaveLength(2);
    expect(respuesta.body).toMatchObject({ totalVinculados: 6, bloqueoAplicado: false });
  });

  it('PF-07 · rechaza la vinculación por encima del cupo e informa los cupos restantes', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/vinculaciones`, { estudianteIds: estudiantes.slice(10, 22) });
    expect(respuesta.status).toBe(409);
    expect(respuesta.body).toMatchObject({ codigo: 'CUPO_EXCEDIDO', cuposDisponibles: 4, seleccionados: 12 });
    const total = await pool.query('SELECT count(*) AS n FROM vinculacion_estudiante WHERE estrategia_id = $1', [estrategia.id]);
    expect(total.rows[0].n).toBe(6);
  });

  it('PF-08 · el Piloto no expone ninguna operación para crear estudiantes', async () => {
    const respuesta = await con(tutor1).post('/estudiantes', { documento: '123', nombres: 'Nuevo' });
    expect(respuesta.status).toBe(404);
    const busqueda = await con(tutor1).get(`/estrategias/${estrategia.id}/candidatos?q=0000000000`);
    expect(busqueda.body.total).toBe(0);
  });

  it('busca estudiantes precargados por documento, por nombre y por grado', async () => {
    const muestra = (await con(tutor1).get(`/estrategias/${estrategia.id}/candidatos?tamano=1`)).body.estudiantes[0];
    const porDocumento = await con(tutor1).get(`/estrategias/${estrategia.id}/candidatos?q=${muestra.documento}`);
    expect(porDocumento.body.estudiantes.map((e: { id: number }) => e.id)).toContain(muestra.id);
    const porNombre = await con(tutor1).get(`/estrategias/${estrategia.id}/candidatos?q=${encodeURIComponent(muestra.apellidos.toUpperCase())}`);
    expect(porNombre.body.total).toBeGreaterThan(0);
    const porGrado = await con(tutor1).get(`/estrategias/${estrategia.id}/candidatos?grado=901&tamano=100`);
    expect(porGrado.body.total).toBe(21);
  });
});

describe('Acompañamiento pedagógico individual (CU-07, RQ_007)', () => {
  let estrategia: { id: number };
  const periodo = { anio: previo.anio, mes: previo.mes };
  const fecha = sumarDias(rangoPrevio.inicio, 9);

  const acompanamiento = (extra: Record<string, unknown> = {}) => ({
    ...periodo,
    docenteId: docentes[0].id,
    fecha,
    modalidad: 'PRESENCIAL',
    tema: 'Planeación por proyectos',
    observaciones: 'Sesión de observación de aula y retroalimentación.',
    compromisos: 'Aplicar la rúbrica en la siguiente clase.',
    ...extra,
  });

  beforeAll(async () => {
    estrategia = await crear('Laboratorio de Física Recreativa');
  });

  it('PI-02 · lista únicamente los docentes asociados a la estrategia', async () => {
    const respuesta = await con(tutor1).get(`/estrategias/${estrategia.id}/periodos/${periodo.anio}/${periodo.mes}/docentes`);
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.docentes.map((d: { id: number }) => d.id).sort()).toEqual(docentes.slice(0, 2).map((d) => d.id).sort());
  });

  it('PF-12 · rechaza el acompañamiento a un docente ajeno a la estrategia, aun por petición directa', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos`, acompanamiento({ docenteId: docenteAjeno }));
    expect(respuesta.status).toBe(403);
    expect(respuesta.body.codigo).toBe('DOCENTE_AJENO');
  });

  it('PF-13 · rechaza una fecha futura indicando el rango válido', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos`, acompanamiento({ anio: anioHoy, mes: mesHoy, fecha: sumarDias(fechaHoy, 1) }));
    expect(respuesta.status).toBe(400);
    expect(['FECHA_FUTURA', 'FECHA_FUERA_DE_PERIODO']).toContain(respuesta.body.codigo);
    expect(respuesta.body.rangoValido.hasta <= fechaHoy).toBe(true);
  });

  it('rechaza una fecha que no pertenece al periodo mensual seleccionado', async () => {
    const respuesta = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos`, acompanamiento({ fecha: fechaHoy }));
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.codigo).toBe('FECHA_FUERA_DE_PERIODO');
  });

  it('PI-03 · registra con la marca de tiempo del servidor y deja la traza en auditoría', async () => {
    const respuesta = await con(tutor1).post(
      `/estrategias/${estrategia.id}/acompanamientos`,
      acompanamiento({ registradoEn: '2020-01-01T00:00:00Z' }), // la hora del cliente se ignora
    );
    expect(respuesta.status).toBe(201);
    expect(Math.abs(Date.now() - new Date(respuesta.body.registradoEn).getTime())).toBeLessThan(60_000);
    expect(respuesta.body.oportuno).toBe(false); // se registró semanas después de realizado

    const traza = await pool.query(
      `SELECT usuario_correo, fecha FROM auditoria WHERE operacion = 'REGISTRAR_ACOMPANAMIENTO' AND registro_id = $1`,
      [String(respuesta.body.id)],
    );
    expect(traza.rows[0].usuario_correo).toBe('tutor1@sses.test');
  });

  it('advierte si el docente ya tiene acompañamiento en el mes y permite complementarlo', async () => {
    const repetido = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos`, acompanamiento());
    expect(repetido.status).toBe(409);
    expect(repetido.body.codigo).toBe('ACOMPANAMIENTO_EXISTENTE');
    const adicional = await con(tutor1).post(`/estrategias/${estrategia.id}/acompanamientos`, acompanamiento({ confirmarAdicional: true }));
    expect(adicional.status).toBe(201);
  });

  it('muestra en el mes siguiente los compromisos del mes anterior', async () => {
    const respuesta = await con(tutor1).get(`/estrategias/${estrategia.id}/periodos/${anioHoy}/${mesHoy}/docentes`);
    const docente = respuesta.body.docentes.find((d: { id: number }) => d.id === docentes[0].id);
    expect(docente.compromisosAnteriores.compromisos).toBe('Aplicar la rúbrica en la siguiente clase.');
  });
});

describe('Seguimiento semanal y cobertura (CU-09, RQ_009)', () => {
  let estrategia: { id: number };
  const periodo = { anio: previo.anio, mes: previo.mes };
  const ruta = (s: { anioIso: number; semanaIso: number }) => `/estrategias/${estrategia.id}/seguimientos/${s.anioIso}/${s.semanaIso}`;
  const reporte = { ...periodo, sinActividad: false, actividades: 'Dos sesiones con el grupo y revisión de proyectos.' };

  beforeAll(async () => {
    estrategia = await crear('Club de Programación');
  });

  it('presenta las semanas del mes como pendientes antes de reportar', async () => {
    const respuesta = await con(tutor1).get(`/estrategias/${estrategia.id}/periodos/${periodo.anio}/${periodo.mes}/semanas`);
    expect(respuesta.body.semanas).toHaveLength(semanasPrevias.length);
    expect(respuesta.body.semanas.every((s: { estado: string }) => s.estado === 'PENDIENTE')).toBe(true);
    expect(respuesta.body.cobertura.porcentaje).toBe(0);
  });

  it('PU-04 · recalcula la cobertura del mes en cada registro', async () => {
    const primera = await con(tutor1).put(ruta(semanasPrevias[0]), reporte);
    expect(primera.status).toBe(200);
    expect(primera.body.creado).toBe(true);
    expect(primera.body.cobertura).toMatchObject({ reportadas: 1, esperadas: semanasPrevias.length });
    expect(primera.body.semana.seguimiento.oportuno).toBe(false); // reportada después de cerrado el mes
  });

  it('PF-16 · una semana sin actividad con causa queda reportada, distinta de una semana en blanco', async () => {
    const sinCausa = await con(tutor1).put(ruta(semanasPrevias[1]), { ...periodo, sinActividad: true });
    expect(sinCausa.status).toBe(400);
    expect(sinCausa.body.codigo).toBe('CAUSA_REQUERIDA');

    const respuesta = await con(tutor1).put(ruta(semanasPrevias[1]), { ...periodo, sinActividad: true, causaInactividad: 'Receso institucional' });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.semana.estado).toBe('SIN_ACTIVIDAD');
    expect(respuesta.body.cobertura.reportadas).toBe(2);
  });

  it('si la semana ya tiene seguimiento lo edita en lugar de duplicarlo', async () => {
    const respuesta = await con(tutor1).put(ruta(semanasPrevias[0]), { ...reporte, actividades: 'Texto corregido de las actividades.' });
    expect(respuesta.body.creado).toBe(false);
    expect(respuesta.body.semana.seguimiento.version).toBe(2);
    expect(respuesta.body.cobertura.reportadas).toBe(2);
    const filas = await pool.query('SELECT count(*) AS n FROM seguimiento_semanal WHERE estrategia_id = $1', [estrategia.id]);
    expect(filas.rows[0].n).toBe(2);
  });

  it('rechaza una semana que no pertenece al periodo mensual seleccionado', async () => {
    const delMesActual = semanasDelMes(anioHoy, mesHoy)[0];
    const respuesta = await con(tutor1).put(ruta(delMesActual), reporte);
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.codigo).toBe('SEMANA_FUERA_DE_PERIODO');
  });

  const semanaFutura = semanasDelMes(anioHoy, mesHoy).find((s) => s.inicio > fechaHoy);
  it.skipIf(!semanaFutura)('impide reportar una semana futura', async () => {
    const respuesta = await con(tutor1).put(ruta(semanaFutura!), { ...reporte, anio: anioHoy, mes: mesHoy });
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.codigo).toBe('SEMANA_FUTURA');
  });

  it('RN-04 · un tutor no puede reportar una estrategia que no tiene asignada, y el intento se audita', async () => {
    const respuesta = await con(tutor2).put(ruta(semanasPrevias[2]), reporte);
    expect(respuesta.status).toBe(403);
    expect(respuesta.body.codigo).toBe('FUERA_DE_AMBITO');
    const traza = await pool.query(
      `SELECT 1 FROM auditoria WHERE operacion = 'ACCESO_DENEGADO' AND usuario_correo = 'tutor2@sses.test' AND registro_id = $1`,
      [String(estrategia.id)],
    );
    expect(traza.rowCount).toBeGreaterThan(0);
  });
});

describe('Tablero de cumplimiento y desempeño (CU-11, RQ_011)', () => {
  it('distingue el seguimiento sostenido del concentrado al cierre en las estrategias sembradas', async () => {
    const respuesta = await con(lider).get(`/tablero?anio=${previo.anio}&mes=${previo.mes}`);
    expect(respuesta.status).toBe(200);
    const porNombre = (nombre: string) => respuesta.body.estrategias.find((e: { nombre: string }) => e.nombre === nombre);

    expect(porNombre('Semillero de Robótica Educativa')).toMatchObject({ coberturaSemanalPct: 100, oportunidadPct: 100, patron: 'SOSTENIDO', docentesAcompanados: 4 });
    expect(porNombre('Club de Lectura Crítica')).toMatchObject({ coberturaSemanalPct: 100, patron: 'CONCENTRADO_AL_CIERRE', docentesAcompanados: 2, docentesAsignados: 3 });
    expect(porNombre('Huerta Escolar Sostenible')).toMatchObject({ patron: 'IRREGULAR', semanasSinActividad: 1 });
    expect(respuesta.body.periodo.preliminar).toBe(true);
  });

  it('consolida por tutor y permite descender al registro individual con autor y fecha', async () => {
    const tablero = await con(lider).get(`/tablero?anio=${previo.anio}&mes=${previo.mes}`);
    const luisa = tablero.body.tutores.find((t: { nombre: string }) => t.nombre.startsWith('Luisa'));
    expect(luisa).toMatchObject({ patron: 'CONCENTRADO_AL_CIERRE', coberturaSemanalPct: 100 });

    const lectura = tablero.body.estrategias.find((e: { nombre: string }) => e.nombre === 'Club de Lectura Crítica');
    const detalle = await con(lider).get(`/tablero/estrategias/${lectura.id}/${previo.anio}/${previo.mes}`);
    expect(detalle.status).toBe(200);
    expect(detalle.body.semanas[0].seguimiento).toMatchObject({ registradoPor: 'Luisa Fernanda Castro Peña', oportuno: false });
    expect(detalle.body.docentesSinAcompanamiento).toHaveLength(1);
  });

  it('filtra por tutor y por entidad', async () => {
    const tutores = await con(lider).get('/catalogos/tutores');
    const andres = tutores.body.find((t: { nombre: string }) => t.nombre.startsWith('Andrés'));
    const respuesta = await con(lider).get(`/tablero?anio=${previo.anio}&mes=${previo.mes}&tutorId=${andres.id}`);
    expect(respuesta.body.estrategias.map((e: { nombre: string }) => e.nombre).sort()).toEqual(['Huerta Escolar Sostenible', 'Semillero de Robótica Educativa']);
  });
});

describe('Control de acceso por perfil y ámbito (CU-01, RQ_001, RQ_002)', () => {
  it('PA-03 · cada perfil conserva su alcance', async () => {
    const delTutor2 = await con(tutor2).get('/estrategias');
    expect(delTutor2.body.every((e: { tutores: { nombre: string }[] }) => e.tutores.some((t) => t.nombre.startsWith('Andrés')))).toBe(true);

    const ajena = delTutor2.body[0].id;
    expect((await con(tutor3).get(`/estrategias/${ajena}`)).status).toBe(403);
    expect((await con(lider).get(`/estrategias/${ajena}`)).status).toBe(200);
  });

  it('el administrador no tiene acceso al registro misional', async () => {
    expect((await con(admin).get('/estrategias')).status).toBe(403);
    expect((await con(admin).get('/tablero')).status).toBe(403);
    expect((await con(admin).get('/auditoria')).status).toBe(200);
  });

  it('las operaciones de cada perfil se rechazan en el servidor para los demás', async () => {
    expect((await con(lider).post('/estrategias', datosEstrategia('Creada por el líder'))).status).toBe(403);
    expect((await con(tutor1).get('/tablero')).status).toBe(403);
    expect((await con(tutor1).get('/auditoria')).status).toBe(403);
    // El acompañamiento lo registra el tutor; el tutor líder lo consulta pero no puede registrarlo.
    const estrategias = await con(lider).get('/estrategias');
    const acompanar = await con(lider).post(`/estrategias/${estrategias.body[0].id}/acompanamientos`, {});
    expect(acompanar.status).toBe(403);
    expect(acompanar.body.codigo).toBe('PERFIL_NO_AUTORIZADO');
  });

  it('sin sesión no hay acceso', async () => {
    expect((await request(app).get('/api/estrategias')).status).toBe(401);
    expect((await request(app).get('/api/estrategias').set('Authorization', 'Bearer token-falso')).status).toBe(401);
  });

  it('bloquea la cuenta al quinto intento fallido y el administrador puede habilitarla', async () => {
    const intentar = (contrasena: string) => request(app).post('/api/auth/login').send({ correo: 'tutor3@sses.test', contrasena });
    for (let i = 1; i <= 4; i++) {
      const fallo = await intentar('clave-incorrecta');
      expect(fallo.status).toBe(401);
      expect(fallo.body.mensaje).not.toMatch(/contraseña incorrecta|usuario no existe/i);
    }
    expect((await intentar('clave-incorrecta')).status).toBe(423);
    expect((await intentar(CONTRASENA_DEMO)).body.codigo).toBe('CUENTA_BLOQUEADA');

    const usuarios = await con(admin).get('/usuarios');
    const bloqueado = usuarios.body.find((u: { correo: string }) => u.correo === 'tutor3@sses.test');
    expect(bloqueado.estado).toBe('BLOQUEADO');
    expect((await con(admin).post(`/usuarios/${bloqueado.id}/desbloquear`, {})).status).toBe(200);
    expect((await intentar(CONTRASENA_DEMO)).status).toBe(200);
  });
});

describe('Auditoría inmutable (RQ_017)', () => {
  it('PS-03 · la traza no admite actualización ni borrado', async () => {
    await expect(pool.query(`UPDATE auditoria SET detalle = 'alterado'`)).rejects.toThrow(/solo anexado/);
    await expect(pool.query(`DELETE FROM auditoria`)).rejects.toThrow(/solo anexado/);
    await expect(pool.query(`TRUNCATE auditoria`)).rejects.toThrow(/solo anexado/);
  });

  it('conserva los valores previos en las modificaciones', async () => {
    const respuesta = await con(admin).get('/auditoria?operacion=MODIFICAR_ESTRATEGIA');
    expect(respuesta.body.total).toBeGreaterThan(0);
    expect(respuesta.body.registros[0].valoresPrevios).toHaveProperty('nombre');
    expect(respuesta.body.registros[0].valoresNuevos).toHaveProperty('nombre');
  });
});
