/**
 * Datos sintéticos del MVP.
 *
 * RQ_021: los ambientes de desarrollo y de demostración no contienen datos personales reales.
 * Todo lo que aquí se genera (entidades, estudiantes, docentes y usuarios) es ficticio.
 *
 * Las fechas son relativas al día en que se ejecuta: el "mes anterior" queda con historia
 * completa y el "mes en curso" con historia parcial, de modo que el tablero muestre desde el
 * arranque el contraste entre un seguimiento sostenido y uno concentrado al cierre.
 */
import bcrypt from 'bcryptjs';
import { Pool, PoolClient } from 'pg';
import { hoy, normalizar } from './domain/reglas';
import { rangoDelMes, semanasDelMes, sumarDias } from './domain/semanas';

export const CONTRASENA_DEMO = 'Sses2026*';

const ENTIDADES = [
  ['IE-1101', 'Institución Educativa Distrital Los Fundadores', 'Bogotá D.C.', 'Andina'],
  ['IE-1501', 'Institución Educativa San José de la Sabana', 'Tunja', 'Andina'],
  ['IE-0501', 'Institución Educativa La Presentación del Valle', 'Medellín', 'Andina'],
  ['IE-1701', 'Instituto Técnico Industrial del Café', 'Manizales', 'Andina'],
  ['IE-0801', 'Institución Educativa Nuestra Señora del Mar', 'Barranquilla', 'Caribe'],
  ['IE-1301', 'Institución Educativa Murallas del Caribe', 'Cartagena', 'Caribe'],
  ['IE-4701', 'Liceo del Norte de la Sierra', 'Santa Marta', 'Caribe'],
  ['IE-2701', 'Institución Educativa Ribera del Atrato', 'Quibdó', 'Pacífica'],
  ['IE-7601', 'Institución Educativa Santa Librada del Sur', 'Cali', 'Pacífica'],
  ['IE-5201', 'Institución Educativa Perla del Pacífico', 'Tumaco', 'Pacífica'],
  ['IE-5001', 'Institución Educativa Llano Grande', 'Villavicencio', 'Orinoquía'],
  ['IE-8501', 'Institución Educativa Morichal del Casanare', 'Yopal', 'Orinoquía'],
] as const;

const NOMBRES = [
  'Sofía', 'Valentina', 'Isabella', 'Mariana', 'Gabriela', 'Daniela', 'Sara', 'Luciana', 'Salomé', 'Antonella',
  'María José', 'Laura', 'Paula', 'Juliana', 'Manuela', 'Natalia', 'Camila', 'Alejandra', 'Ximena', 'Verónica',
  'Santiago', 'Mateo', 'Sebastián', 'Samuel', 'Nicolás', 'Alejandro', 'Daniel', 'Emiliano', 'Tomás', 'Juan Pablo',
  'Andrés', 'Felipe', 'David', 'Miguel Ángel', 'Julián', 'Esteban', 'Simón', 'Martín', 'Jerónimo', 'Cristian',
];

const APELLIDOS = [
  'Rodríguez', 'Gómez', 'González', 'Martínez', 'García', 'López', 'Hernández', 'Sánchez', 'Ramírez', 'Pérez',
  'Díaz', 'Muñoz', 'Rojas', 'Moreno', 'Jiménez', 'Vargas', 'Castro', 'Ortiz', 'Suárez', 'Gutiérrez',
  'Álvarez', 'Torres', 'Ruiz', 'Mendoza', 'Cárdenas', 'Quintero', 'Ospina', 'Marín', 'Zapata', 'Valencia',
  'Mosquera', 'Cortés', 'Peña', 'Acosta', 'Beltrán', 'Cabrera', 'Arango', 'Londoño', 'Barrios', 'Pineda',
];

const AREAS = ['Matemáticas', 'Lenguaje', 'Ciencias Naturales', 'Ciencias Sociales', 'Tecnología e Informática'];
const GRADOS = ['601', '602', '701', '702', '801', '802', '901', '902', '1001', '1002', '1101', '1102'];
const ESTUDIANTES_POR_GRADO = 21;

/** Generador pseudoaleatorio determinista: el seed produce siempre los mismos datos. */
function crearAleatorio(semilla: number) {
  let estado = semilla;
  return () => {
    estado |= 0;
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const marca = (fecha: string, hora: string) => `${fecha}T${hora}:00-05:00`;

export async function sembrar(pool: Pool) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const resumen = await cargar(tx);
    await tx.query('COMMIT');
    return resumen;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}

async function cargar(tx: PoolClient) {
  const azar = crearAleatorio(20261112);
  const elegir = <T>(lista: readonly T[]): T => lista[Math.floor(azar() * lista.length)];

  // ------------------------------------------------------------------ Entidades
  const entidadIds: number[] = [];
  for (const [codigo, nombre, municipio, territorio] of ENTIDADES) {
    const { rows } = await tx.query(
      `INSERT INTO entidad (codigo, nombre, municipio, territorio) VALUES ($1, $2, $3, $4) RETURNING id`,
      [codigo, nombre, municipio, territorio],
    );
    entidadIds.push(rows[0].id);
  }
  const deTerritorio = (territorio: string) => entidadIds.filter((_, i) => ENTIDADES[i][3] === territorio);

  // ------------------------------------------------------------------ Estudiantes precargados
  const est = { tipo: [] as string[], doc: [] as string[], nom: [] as string[], ape: [] as string[], bus: [] as string[], gra: [] as string[], ent: [] as number[] };
  let consecutivo = 0;
  for (const entidadId of entidadIds) {
    for (const grado of GRADOS) {
      for (let i = 0; i < ESTUDIANTES_POR_GRADO; i++) {
        const nombres = elegir(NOMBRES);
        const apellidos = `${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`;
        est.tipo.push('TI');
        est.doc.push(String(1030000000 + consecutivo * 13));
        est.nom.push(nombres);
        est.ape.push(apellidos);
        est.bus.push(normalizar(`${nombres} ${apellidos}`));
        est.gra.push(grado);
        est.ent.push(entidadId);
        consecutivo++;
      }
    }
  }
  await tx.query(
    `INSERT INTO estudiante (tipo_documento, documento, nombres, apellidos, nombre_busqueda, grado, entidad_id)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[])`,
    [est.tipo, est.doc, est.nom, est.ape, est.bus, est.gra, est.ent],
  );

  // ------------------------------------------------------------------ Docentes precargados
  const docentesPorEntidad = new Map<number, number[]>();
  let numeroDocente = 0;
  for (const entidadId of entidadIds) {
    const ids: number[] = [];
    for (const area of AREAS) {
      const nombre = `${elegir(NOMBRES)} ${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`;
      const { rows } = await tx.query(
        `INSERT INTO docente (documento, nombre, area, entidad_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [String(52000000 + numeroDocente * 17), nombre, area, entidadId],
      );
      ids.push(rows[0].id);
      numeroDocente++;
    }
    docentesPorEntidad.set(entidadId, ids);
  }

  // ------------------------------------------------------------------ Usuarios y ámbitos
  const hash = bcrypt.hashSync(CONTRASENA_DEMO, 10);
  const andina = deTerritorio('Andina');
  const caribe = deTerritorio('Caribe');
  const usuarios = [
    { clave: 'tutor1', nombre: 'Camila Torres Rincón', perfil: 'TUTOR', ambito: andina },
    { clave: 'tutor2', nombre: 'Andrés Felipe Mejía Ortiz', perfil: 'TUTOR', ambito: andina },
    { clave: 'tutor3', nombre: 'Luisa Fernanda Castro Peña', perfil: 'TUTOR', ambito: caribe },
    { clave: 'lider', nombre: 'Marta Lucía Gómez Herrera', perfil: 'TUTOR_LIDER', ambito: [...andina, ...caribe] },
    { clave: 'control', nombre: 'Patricia Elena Rojas Lozano', perfil: 'ENTE_CONTROL', ambito: [] as number[] },
    { clave: 'admin', nombre: 'Ricardo Salazar Pinto', perfil: 'ADMIN', ambito: [] as number[] },
    { clave: 'soporte', nombre: 'Diego Alejandro Ruiz Cano', perfil: 'SOPORTE', ambito: [] as number[] },
  ];
  const usuarioId: Record<string, number> = {};
  for (const [i, u] of usuarios.entries()) {
    const { rows } = await tx.query(
      `INSERT INTO usuario (documento, nombre, correo, hash_contrasena, perfil) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [String(79000100 + i * 31), u.nombre, `${u.clave}@sses.test`, hash, u.perfil],
    );
    usuarioId[u.clave] = rows[0].id;
    if (u.ambito.length) {
      await tx.query(`INSERT INTO ambito_usuario (usuario_id, entidad_id) SELECT $1, unnest($2::int[])`, [rows[0].id, u.ambito]);
    }
  }

  // ------------------------------------------------------------------ Calendario relativo a hoy
  const fechaHoy = hoy();
  const [anioActual, mesActual] = fechaHoy.split('-').map(Number);
  const previo = mesActual === 1 ? { anio: anioActual - 1, mes: 12 } : { anio: anioActual, mes: mesActual - 1 };
  const actual = { anio: anioActual, mes: mesActual };
  const rangoPrevio = rangoDelMes(previo.anio, previo.mes);
  const semanasPrevias = semanasDelMes(previo.anio, previo.mes);
  const semanasActuales = semanasDelMes(actual.anio, actual.mes);
  const finVigencia = sumarDias(fechaHoy, 90);
  const diaPrevio = (dia: number) => sumarDias(rangoPrevio.inicio, dia - 1);

  // ------------------------------------------------------------------ Utilidades de carga
  async function crearEstrategia(d: {
    entidadId: number; nombre: string; objetivo: string; modalidad: string; inicio: string; cupo: number;
    tutor: string; docentes: number; estudiantes: number; grados: string[];
  }) {
    const docenteIds = (docentesPorEntidad.get(d.entidadId) ?? []).slice(0, d.docentes);
    const bloqueada = d.estudiantes > 0;
    const { rows } = await tx.query(
      `INSERT INTO estrategia
         (codigo, entidad_id, nombre, nombre_normalizado, objetivo, modalidad, fecha_inicio, fecha_fin, cupo_maximo,
          estado, creado_por, creado_en, actualizado_en, bloqueada_en)
       VALUES ('EST-' || lpad(nextval('estrategia_consecutivo_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $11, $12)
       RETURNING id, codigo`,
      [
        d.entidadId, d.nombre, normalizar(d.nombre), d.objetivo, d.modalidad, d.inicio, finVigencia, d.cupo,
        bloqueada ? 'BLOQUEADA' : 'EDITABLE', usuarioId[d.tutor],
        marca(sumarDias(d.inicio, -3), '09:15'),
        bloqueada ? marca(sumarDias(d.inicio, 1), '08:40') : null,
      ],
    );
    const id = rows[0].id as number;
    await tx.query(`INSERT INTO estrategia_tutor (estrategia_id, usuario_id) VALUES ($1, $2)`, [id, usuarioId[d.tutor]]);
    await tx.query(`INSERT INTO estrategia_docente (estrategia_id, docente_id) SELECT $1, unnest($2::int[])`, [id, docenteIds]);
    if (bloqueada) {
      await tx.query(
        `INSERT INTO vinculacion_estudiante (estrategia_id, estudiante_id, fecha_vinculacion, vinculado_por, creado_en)
         SELECT $1, s.id, $2, $3, $4
           FROM (SELECT id FROM estudiante WHERE entidad_id = $5 AND grado = ANY($6::text[])
                  ORDER BY grado, apellidos, nombres LIMIT $7) s`,
        [id, sumarDias(d.inicio, 1), usuarioId[d.tutor], marca(sumarDias(d.inicio, 1), '08:40'), d.entidadId, d.grados, d.estudiantes],
      );
    }
    return { id, codigo: rows[0].codigo as string, docenteIds };
  }

  async function periodoId(estrategiaId: number, p: { anio: number; mes: number }) {
    const { rows } = await tx.query(
      `INSERT INTO periodo_mensual (estrategia_id, anio, mes) VALUES ($1, $2, $3)
       ON CONFLICT (estrategia_id, anio, mes) DO UPDATE SET anio = EXCLUDED.anio RETURNING id`,
      [estrategiaId, p.anio, p.mes],
    );
    return rows[0].id as number;
  }

  let totalAcompanamientos = 0;
  // El acompañamiento lo realiza y lo registra el tutor de la estrategia (ver CORRECCIONES-PROPUESTA.md).
  async function acompanar(estrategiaId: number, p: { anio: number; mes: number }, docenteId: number, fecha: string, registradoEn: string, tema: string, compromisos: string, tutor: string) {
    await tx.query(
      `INSERT INTO acompanamiento (periodo_id, estrategia_id, docente_id, tipo, fecha, modalidad, tema, observaciones, compromisos, registrado_por, registrado_en)
       VALUES ($1, $2, $3, 'INDIVIDUAL', $4, 'PRESENCIAL', $5, $6, $7, $8, $9)`,
      [
        await periodoId(estrategiaId, p), estrategiaId, docenteId, fecha, tema,
        'Se observó la sesión de aula y se retroalimentó la planeación con el docente. Buena disposición y apropiación de la estrategia.',
        compromisos, usuarioId[tutor], registradoEn,
      ],
    );
    totalAcompanamientos++;
  }

  async function acompanarEnGrupo(estrategiaId: number, p: { anio: number; mes: number }, docenteIds: number[], fecha: string, registradoEn: string, tema: string, tutor: string) {
    const periodo = await periodoId(estrategiaId, p);
    const { rows } = await tx.query(
      `INSERT INTO sesion_grupal (periodo_id, estrategia_id, fecha, modalidad, tema, registrado_por, registrado_en)
       VALUES ($1, $2, $3, 'PRESENCIAL', $4, $5, $6) RETURNING id`,
      [periodo, estrategiaId, fecha, tema, usuarioId[tutor], registradoEn],
    );
    await tx.query(
      `INSERT INTO acompanamiento (periodo_id, estrategia_id, docente_id, tipo, fecha, modalidad, tema, observaciones, compromisos, sesion_grupal_id, registrado_por, registrado_en)
       SELECT $1, $2, unnest($3::int[]), 'GRUPAL', $4, 'PRESENCIAL', $5, $6, $7, $8, $9, $10`,
      [periodo, estrategiaId, docenteIds, fecha, tema,
        'Jornada colectiva de planeación con los docentes de la estrategia.',
        'Cada docente diseña una actividad para la feria de la huerta.', rows[0].id, usuarioId[tutor], registradoEn],
    );
    totalAcompanamientos += docenteIds.length;
  }

  /** Cierre del periodo, con la fecha en que se hizo; solo si esa fecha ya pasó. */
  async function cerrar(estrategiaId: number, p: { anio: number; mes: number }, tutor: string, fecha: string, extemporaneo: boolean, justificacion: string | null) {
    if (fecha >= fechaHoy) return false;
    await tx.query(
      `UPDATE periodo_mensual SET estado = 'CERRADO', cerrado_por = $4, cerrado_en = $5, extemporaneo = $6,
              justificacion_cierre = $7, resumen_cierre = '{}'::jsonb
        WHERE estrategia_id = $1 AND anio = $2 AND mes = $3`,
      [estrategiaId, p.anio, p.mes, usuarioId[tutor], marca(fecha, '17:30'), extemporaneo, justificacion],
    );
    return true;
  }

  let totalSeguimientos = 0;
  async function seguir(estrategiaId: number, p: { anio: number; mes: number }, semana: { anioIso: number; semanaIso: number; inicio: string; fin: string }, tutor: string, registradoEn: string, causaInactividad?: string) {
    await tx.query(
      `INSERT INTO seguimiento_semanal
         (periodo_id, estrategia_id, anio_iso, semana_iso, inicio_semana, fin_semana, sin_actividad, causa_inactividad,
          actividades, avance_compromisos, dificultades, acciones, registrado_por, registrado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        await periodoId(estrategiaId, p), estrategiaId, semana.anioIso, semana.semanaIso, semana.inicio, semana.fin,
        Boolean(causaInactividad), causaInactividad ?? null,
        causaInactividad ? null : 'Se desarrollaron las dos sesiones previstas con el grupo y se revisaron los avances de los proyectos.',
        causaInactividad ? null : 'Los docentes aplicaron la guía acordada en el acompañamiento del mes.',
        causaInactividad ? null : 'Asistencia irregular de algunos estudiantes por cruce con otras actividades.',
        causaInactividad ? null : 'Se acordó con coordinación un horario fijo para la estrategia.',
        usuarioId[tutor], registradoEn,
      ],
    );
    totalSeguimientos++;
  }

  // ------------------------------------------------------------------ A. Seguimiento SOSTENIDO
  const robotica = await crearEstrategia({
    entidadId: andina[0], nombre: 'Semillero de Robótica Educativa',
    objetivo: 'Fortalecer el pensamiento computacional de los estudiantes mediante retos de robótica y trabajo por proyectos.',
    modalidad: 'PRESENCIAL', inicio: rangoPrevio.inicio, cupo: 30, tutor: 'tutor2', docentes: 4, estudiantes: 24, grados: ['901', '902'],
  });
  for (const [i, dia] of [6, 8, 13, 15].entries()) {
    await acompanar(robotica.id, previo, robotica.docenteIds[i], diaPrevio(dia), marca(diaPrevio(dia + 1), '10:30'),
      'Planeación de retos de robótica por niveles', 'Aplicar la rúbrica de evaluación por proyectos en la siguiente sesión.', 'tutor2');
  }
  for (const semana of semanasPrevias) {
    // Reportado cada viernes, dentro de la misma semana.
    await seguir(robotica.id, previo, semana, 'tutor2', marca(sumarDias(semana.inicio, 4), '16:20'));
  }
  for (const semana of semanasActuales.filter((s) => s.fin < fechaHoy)) {
    await seguir(robotica.id, actual, semana, 'tutor2', marca(sumarDias(semana.inicio, 4), '16:35'));
  }
  const rangoActual = rangoDelMes(actual.anio, actual.mes);
  for (const [i, dia] of [4, 6].entries()) {
    const fecha = sumarDias(rangoActual.inicio, dia - 1);
    if (sumarDias(fecha, 1) < fechaHoy) {
      await acompanar(robotica.id, actual, robotica.docenteIds[i], fecha, marca(sumarDias(fecha, 1), '11:10'),
        'Seguimiento a la rúbrica de evaluación por proyectos', 'Socializar los resultados de la rúbrica con el equipo de área.', 'tutor2');
    }
  }

  // ------------------------------------------------------------------ B. Todo CONCENTRADO AL CIERRE
  const lectura = await crearEstrategia({
    entidadId: caribe[0], nombre: 'Club de Lectura Crítica',
    objetivo: 'Mejorar la comprensión lectora y la argumentación oral de los estudiantes a través de círculos de lectura.',
    modalidad: 'MIXTA', inicio: rangoPrevio.inicio, cupo: 25, tutor: 'tutor3', docentes: 3, estudiantes: 18, grados: ['801'],
  });
  for (const [i, dia] of [9, 20].entries()) {
    await acompanar(lectura.id, previo, lectura.docenteIds[i], diaPrevio(dia), marca(rangoPrevio.fin, '22:05'),
      'Estrategias de lectura inferencial', 'Incorporar preguntas de nivel inferencial en las guías de lectura.', 'tutor3');
  }
  for (const [i, semana] of semanasPrevias.entries()) {
    // Las semanas de todo el mes diligenciadas el último día, con minutos de diferencia.
    await seguir(lectura.id, previo, semana, 'tutor3', marca(rangoPrevio.fin, `21:${String(40 + i * 4).padStart(2, '0')}`));
  }

  // ------------------------------------------------------------------ C. Registro IRREGULAR, con semana sin actividad
  const huerta = await crearEstrategia({
    entidadId: andina[2], nombre: 'Huerta Escolar Sostenible',
    objetivo: 'Desarrollar competencias científicas y ambientales mediante el diseño y el cuidado de una huerta escolar.',
    modalidad: 'PRESENCIAL', inicio: rangoPrevio.inicio, cupo: 20, tutor: 'tutor2', docentes: 3, estudiantes: 15, grados: ['701'],
  });
  for (const [i, dia] of [7, 14].entries()) {
    await acompanar(huerta.id, previo, huerta.docenteIds[i], diaPrevio(dia), marca(diaPrevio(dia + 2), '09:50'),
      'Indagación científica en la huerta', 'Registrar con los estudiantes una bitácora semanal de observaciones.', 'tutor2');
  }
  // Una jornada colectiva con los tres docentes: un acompañamiento por cada asistente.
  await acompanarEnGrupo(huerta.id, previo, huerta.docenteIds, diaPrevio(21), marca(diaPrevio(22), '08:15'),
    'Planeación conjunta de la feria de la huerta', 'tutor2');
  for (const [i, semana] of semanasPrevias.entries()) {
    if (i === 0) await seguir(huerta.id, previo, semana, 'tutor2', marca(sumarDias(semana.fin, 8), '18:05'));
    else if (i === 1) await seguir(huerta.id, previo, semana, 'tutor2', marca(sumarDias(semana.inicio, 4), '15:10'), 'Receso institucional');
    else if (i === 2) await seguir(huerta.id, previo, semana, 'tutor2', marca(sumarDias(semana.fin, 6), '18:20'));
    // La cuarta semana quedó sin reportar.
    else if (i >= 4) await seguir(huerta.id, previo, semana, 'tutor2', marca(sumarDias(semana.inicio, 4), '15:30'));
  }

  // ------------------------------------------------------------------ Cierres del mes anterior
  // Robótica se cerró a tiempo; la Huerta, fuera de plazo y con justificación; Lectura Crítica sigue abierta.
  const inicioActual = rangoDelMes(actual.anio, actual.mes).inicio;
  await cerrar(robotica.id, previo, 'tutor2', sumarDias(inicioActual, 1), false, null);
  await cerrar(huerta.id, previo, 'tutor2', sumarDias(inicioActual, 8), true,
    'La cuarta semana no se reportó porque coincidió con la jornada de evaluaciones institucionales y no se tomó registro.');

  // ------------------------------------------------------------------ D. Estrategia aún EDITABLE
  const ajedrez = await crearEstrategia({
    entidadId: andina[3], nombre: 'Escuela de Ajedrez y Pensamiento Lógico',
    objetivo: 'Estimular el razonamiento lógico y la toma de decisiones de los estudiantes mediante la práctica del ajedrez.',
    modalidad: 'PRESENCIAL', inicio: rangoActual.inicio, cupo: 20, tutor: 'tutor1', docentes: 2, estudiantes: 0, grados: [],
  });

  // ------------------------------------------------------------------ Traza de la carga inicial
  const resumen = {
    entidades: entidadIds.length,
    estudiantes: est.doc.length,
    docentes: numeroDocente,
    usuarios: usuarios.length,
    estrategias: [robotica.codigo, lectura.codigo, huerta.codigo, ajedrez.codigo],
    acompanamientos: totalAcompanamientos,
    seguimientos: totalSeguimientos,
  };
  await tx.query(
    `INSERT INTO auditoria (usuario_id, usuario_correo, operacion, entidad_afectada, valores_nuevos, detalle)
     VALUES ($1, 'admin@sses.test', 'CARGA_INICIAL', 'SISTEMA', $2, $3)`,
    [usuarioId.admin, JSON.stringify(resumen), 'Carga inicial de datos sintéticos del Piloto (entidades, estudiantes, docentes y usuarios)'],
  );
  return resumen;
}
