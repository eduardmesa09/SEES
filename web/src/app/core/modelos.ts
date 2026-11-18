export type Perfil = 'TUTOR' | 'TUTOR_LIDER' | 'ENTE_CONTROL' | 'ADMIN' | 'SOPORTE';

export interface Usuario {
  id: number;
  nombre: string;
  correo: string;
  perfil: Perfil;
  entidades: number[];
  region: string;
  debeCambiarContrasena: boolean;
}

export interface Entidad {
  id: number;
  codigo: string;
  nombre: string;
  municipio: string;
  territorio: string;
}

export interface Persona {
  id: number;
  nombre: string;
  correo?: string;
  area?: string;
  documento?: string;
}

export type EstadoEstrategia = 'EDITABLE' | 'BLOQUEADA';

export interface Estrategia {
  id: number;
  codigo: string;
  nombre: string;
  objetivo: string;
  modalidad: string;
  fechaInicio: string;
  fechaFin: string;
  cupoMaximo: number;
  estado: EstadoEstrategia;
  version: number;
  creadoEn: string;
  bloqueadaEn: string | null;
  entidadId: number;
  entidadNombre: string;
  municipio: string;
  territorio: string;
  vinculados: number;
  tutores: Persona[];
  docentes?: number;
  solicitudesPendientes?: number;
}

export interface EstrategiaDetalle extends Omit<Estrategia, 'docentes'> {
  cupoDisponible: number;
  docentes: Persona[];
  solicitudes: {
    id: number; cambiosSolicitados: string; justificacion: string; estado: string; creadoEn: string; solicitadoPor: string;
    respuesta: string | null; resueltoEn: string | null; resueltoPor: string | null;
  }[];
  versiones: { id: number; version: number; datos: Record<string, unknown>; modificadoEn: string; modificadoPor: string }[];
  permisos: { editar: boolean; vincular: boolean; desvincular: boolean; solicitarModificacion: boolean };
  edicionAutorizada: boolean;
  motivoBloqueo: string | null;
}

export interface Estudiante {
  id: number;
  tipoDocumento: string;
  documento: string;
  nombres: string;
  apellidos: string;
  grado: string;
  yaVinculado?: boolean;
}

export interface Candidatos {
  estrategia: {
    id: number; codigo: string; nombre: string; estado: EstadoEstrategia; entidadNombre: string;
    cupoMaximo: number; vinculados: number; cupoDisponible: number; vencida: boolean;
  };
  cargaPendiente: boolean;
  grados: string[];
  total: number;
  pagina: number;
  tamano: number;
  estudiantes: Estudiante[];
}

export interface Vinculado extends Estudiante {
  estudianteId: number;
  estado: 'ACTIVA' | 'INACTIVA';
  fechaVinculacion: string;
  vinculadoPor: string;
  fechaDesvinculacion: string | null;
  motivoDesvinculacion: string | null;
}

export interface ResultadoVinculacion {
  vinculados: { id: number; documento: string; nombre: string; grado: string }[];
  descartados: { id: number; documento: string; nombre: string; grado: string }[];
  totalVinculados: number;
  cupoMaximo: number;
  cupoDisponible: number;
  estadoAnterior: EstadoEstrategia;
  estadoEstrategia: EstadoEstrategia;
  bloqueoAplicado: boolean;
  fechaVinculacion: string;
}

export interface Periodo {
  anio: number;
  mes: number;
  nombre: string;
  enCurso: boolean;
  estado: 'ABIERTO' | 'CERRADO';
  corregido: boolean;
  reaperturaPendiente: boolean;
}

/** Estado de un periodo mensual: abierto, o cerrado con su autor, fecha y justificación. */
export interface EstadoPeriodo {
  anio: number;
  mes: number;
  nombre: string;
  estado: 'ABIERTO' | 'CERRADO';
  cerradoEn: string | null;
  cerradoPor: string | null;
  justificacionCierre: string | null;
  extemporaneo: boolean;
  corregido: boolean;
  version: number;
  reaperturaPendiente: boolean;
}

export interface ResumenCierre {
  periodo: EstadoPeriodo;
  resumen: {
    docentesAsignados: number; docentesAcompanados: number; acompanamientosIndividuales: number; sesionesGrupales: number;
    semanasEsperadas: number; semanasReportadas: number; semanasSinActividad: number;
    semanasPendientes: { semanaIso: number; inicio: string; fin: string }[];
    docentesSinAcompanamiento: string[]; registros: number; completo: boolean;
  };
  mesTerminado: boolean;
  plazo: string;
  extemporaneo: boolean;
}

export interface Acompanamiento {
  id: number;
  docenteId: number;
  docenteNombre: string;
  tipo: string;
  fecha: string;
  modalidad: string;
  tema: string;
  observaciones: string;
  compromisos: string;
  avanceCompromisos: string | null;
  sesionGrupalId: number | null;
  registradoPor: string;
  registradoEn: string;
  oportuno: boolean;
  diasRetraso: number;
}

export interface SesionGrupal {
  id: number; fecha: string; tema: string; modalidad: string; registradoPor: string; registradoEn: string;
  oportuno: boolean; diasRetraso: number; asistentes: string[];
}

export interface DocenteDelPeriodo extends Persona {
  acompanamientos: Acompanamiento[];
  compromisosAnteriores: { fecha: string; tema: string; compromisos: string } | null;
}

export interface DocentesDelPeriodo {
  periodo: EstadoPeriodo;
  rangoValido: { desde: string; hasta: string };
  docentes: DocenteDelPeriodo[];
  sesionesGrupales: SesionGrupal[];
  resumen: { asignados: number; acompanados: number };
}

export type EstadoSemana = 'REPORTADA' | 'SIN_ACTIVIDAD' | 'PENDIENTE' | 'EN_CURSO' | 'FUTURA';

export interface Seguimiento {
  id: number;
  sinActividad: boolean;
  causaInactividad: string | null;
  actividades: string | null;
  avanceCompromisos: string | null;
  dificultades: string | null;
  acciones: string | null;
  registradoPor: string;
  registradoEn: string;
  actualizadoEn: string | null;
  fechaRegistro: string;
  version: number;
  oportuno: boolean;
  diasRetraso: number;
}

export interface Semana {
  anioIso: number;
  semanaIso: number;
  inicio: string;
  fin: string;
  estado: EstadoSemana;
  seguimiento: Seguimiento | null;
}

export interface Cobertura {
  reportadas: number;
  esperadas: number;
  porcentaje: number;
}

export interface SemanasDelPeriodo {
  periodo: EstadoPeriodo;
  semanas: Semana[];
  cobertura: Cobertura;
  exigibles: number;
  pendientes: number;
}

export type Patron = 'SIN_REGISTROS' | 'SOSTENIDO' | 'CONCENTRADO_AL_CIERRE' | 'IRREGULAR';

export interface SemanaDelTablero {
  anioIso: number;
  semanaIso: number;
  inicio: string;
  fin: string;
  registro: { fechaRegistro: string; oportuno: boolean; diasRetraso: number; sinActividad: boolean } | null;
}

export interface FilaTablero {
  id: number;
  codigo: string;
  nombre: string;
  estado: EstadoEstrategia;
  entidadNombre: string;
  territorio: string;
  tutores: Persona[];
  vinculados: number;
  cupoMaximo: number;
  docentesAsignados: number;
  docentesAcompanados: number;
  acompanamientos: number;
  acompanamientosIndividuales: number;
  sesionesGrupales: number;
  acompanamientosOportunos: number;
  periodo: { estado: 'ABIERTO' | 'CERRADO'; cerradoEn: string | null; cerradoPor: string | null; extemporaneo: boolean; corregido: boolean; justificacion: string | null };
  semanasEsperadas: number;
  semanasExigibles: number;
  semanasReportadas: number;
  semanasSinActividad: number;
  coberturaSemanalPct: number;
  registrosOportunos: number;
  registrosTardios: number;
  oportunidadPct: number;
  patron: Patron;
  semanas: SemanaDelTablero[];
}

export interface TutorTablero {
  id: number;
  nombre: string;
  estrategias: number;
  semanasExigibles: number;
  semanasReportadas: number;
  docentesAsignados: number;
  docentesAcompanados: number;
  coberturaSemanalPct: number;
  coberturaDocentesPct: number;
  registrosOportunos: number;
  registrosTardios: number;
  oportunidadPct: number;
  patron: Patron;
  acompanamientos: number;
  sesionesGrupales: number;
  periodosCerrados: number;
  cierresExtemporaneos: number;
}

export interface Tablero {
  periodo: {
    anio: number; mes: number; nombre: string; enCurso: boolean; preliminar: boolean; advertencia: string;
    periodosCerrados: number; periodosAbiertos: number;
  };
  resumen: {
    estrategias: number; estudiantesVinculados: number; docentesAsignados: number; docentesAcompanados: number;
    coberturaDocentesPct: number; acompanamientos: number; acompanamientosIndividuales: number; sesionesGrupales: number;
    semanasExigibles: number; semanasReportadas: number; coberturaSemanalPct: number; oportunidadPct: number;
  };
  estrategias: FilaTablero[];
  tutores: TutorTablero[];
}

export interface DetalleTablero {
  estrategia: { id: number; codigo: string; nombre: string; entidadNombre: string; territorio: string };
  periodo: EstadoPeriodo & { preliminar: boolean };
  semanas: Semana[];
  cobertura: Cobertura;
  acompanamientos: Acompanamiento[];
  docentesSinAcompanamiento: Persona[];
}

export interface RegistroAuditoria {
  id: number;
  fecha: string;
  usuarioCorreo: string | null;
  usuarioNombre: string | null;
  perfil: Perfil | null;
  operacion: string;
  entidadAfectada: string;
  registroId: string | null;
  valoresPrevios: unknown;
  valoresNuevos: unknown;
  detalle: string | null;
  ip: string | null;
}

export interface PaginaAuditoria {
  total: number;
  pagina: number;
  tamano: number;
  operaciones: string[];
  registros: RegistroAuditoria[];
}

export interface UsuarioAdmin {
  id: number;
  documento: string;
  nombre: string;
  correo: string;
  perfil: Perfil;
  estado: 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO';
  motivoEstado: string | null;
  intentosFallidos: number;
  ultimoAcceso: string | null;
  pendienteActivacion: boolean;
  ambito: string[];
  entidadIds: number[];
  estrategiasACargo: number;
}

export interface EntidadConCarga extends Entidad {
  estudiantes: number;
  docentes: number;
}

export interface Credenciales {
  id: number;
  correo: string;
  contrasenaTemporal: string;
}

export interface Listas {
  modalidades: string[];
  causasInactividad: string[];
  motivosDesvinculacion: string[];
  politicaContrasena: string;
  hoy: string;
}

export interface SolicitudModificacion {
  id: number; estrategiaId: number; codigo: string; estrategiaNombre: string; entidadNombre: string;
  cambiosSolicitados: string; justificacion: string; estado: string; creadoEn: string; solicitadoPor: string;
  respuesta: string | null; resueltoEn: string | null; resueltoPor: string | null;
}

export interface SolicitudReapertura {
  id: number; motivo: string; estado: string; creadoEn: string; respuesta: string | null; resueltoEn: string | null;
  solicitadoPor: string; resueltoPor: string | null; anio: number; mes: number; periodo: string; cerradoEn: string;
  extemporaneo: boolean; justificacionCierre: string | null; estrategiaId: number; codigo: string;
  estrategiaNombre: string; entidadNombre: string;
}

export interface Observacion {
  id: number; anio: number; mes: number; periodo: string; texto: string; creadoEn: string; leidaEn: string | null;
  autor: string; tutor: string; estrategiaCodigo: string | null; estrategiaNombre: string | null;
}

export interface CifrasReporte {
  estrategiasActivas: number; estudiantesVinculados: number; docentesAsignados: number; docentesAcompanados: number;
  acompanamientosIndividuales: number; sesionesGrupales: number; semanasEsperadas: number; semanasReportadas: number;
  coberturaSemanalPct: number;
}

export interface CoberturaInformacion {
  estrategiasDelAlcance: number; estrategiasCerradas: number; estrategiasExcluidas: number; porcentaje: number;
}

export interface GrupoReporte {
  nombre: string; territorio: string; estrategias: number; estudiantesVinculados: number; docentesAcompanados: number;
  docentesAsignados: number; acompanamientosIndividuales: number; sesionesGrupales: number;
  coberturaSemanalPct: number; coberturaInformacionPct: number;
}

export interface VersionCertificada {
  id: number; version: number; alcance: string; codigoVerificacion: string; certificadoEn: string; certificadoPor: string;
  motivoAjuste: string | null;
}

export interface Consolidado {
  periodo: { anio: number; mes: number; nombre: string };
  fechaCorte: string;
  alcance: string;
  cifras: CifrasReporte;
  coberturaInformacion: CoberturaInformacion;
  porTerritorio: GrupoReporte[];
  porEntidad: GrupoReporte[];
  pendientes: { estrategiaId: number; codigo: string; nombre: string; entidadNombre: string; tutores: string[] }[];
  estrategias: FilaTablero[];
  tutores: TutorTablero[];
}

export interface ReporteDeLey extends Consolidado {
  mesTerminado: boolean;
  certificable: boolean;
  versiones: VersionCertificada[];
}

export interface ReporteDeControl extends Consolidado {
  certificacion:
    | { estado: 'PRELIMINAR' }
    | (VersionCertificada & {
        estado: 'CERTIFICADO'; cifras: CifrasReporte; coberturaInformacion: CoberturaInformacion;
        exclusiones: { estrategiaId: number; motivo: string; codigo: string | null; nombre: string | null }[];
        anteriores: VersionCertificada[];
      });
}

export interface Certificado extends VersionCertificada {
  tipo: string; anio: number; mes: number; periodo: string; exclusiones: number; vigente: boolean;
  cifras: CifrasReporte; coberturaInformacion: CoberturaInformacion;
}

export interface ResultadoCarga {
  id: number; tipo: string; archivo: string; filas: number; aceptados: number; rechazados: number; consolidados: number;
  rechazos: { fila: number; documento: string; motivo: string }[]; cargadoEn: string;
}

export interface CargaHistorial {
  id: number; tipo: string; archivo: string; filas: number; aceptados: number; rechazados: number; cargadoEn: string; cargadoPor: string;
  informe: { rechazos: { fila: number; documento: string; motivo: string }[]; consolidados: unknown[]; repetidos: number };
}

export interface Servicio { nombre: string; disponible: boolean; detalle: string }

export interface ResumenOperacion {
  peticiones: number; p50: number; p95: number; maximoMs: number; errores: number; rechazos: number;
  erroresRepetidos: { metodo: string; ruta: string; estado: number; veces: number; ultima: number }[];
  concurrenciaMaxima: number; usuarios: number;
}

export interface SesionPilotaje {
  id: number; nombre: string; estado: 'PROGRAMADA' | 'RETRASADA' | 'INICIADA' | 'FINALIZADA' | 'SUSPENDIDA';
  verificacion: { servicios: Servicio[]; todosDisponibles: boolean; verificadoEn: string } | null;
  verificadaEn: string | null; causaRetraso: string | null; iniciadaEn: string | null; finalizadaEn: string | null;
  causaCierre: string | null; creadaEn: string; creadaPor: string; incidentes: number;
  reporte: { operacion: ResumenOperacion; incidentes: { total: number; resueltos: number; criticos: number; sinCompletarRegistro: number; promedioSolucionMin: number | null }; umbralP95Ms: number } | null;
}

export interface Incidente {
  id: number; ocurridoEn: string; usuarioAfectado: string; region: string; descripcion: string; accion: string;
  completoRegistro: boolean; resueltoEn: string | null; registradoPor: string; minutosSolucion: number | null;
  critico: boolean; minutosAbierto: number;
}

export interface DetalleSesion extends Omit<SesionPilotaje, 'incidentes'> {
  incidentes: Incidente[];
  operacion: ResumenOperacion | null;
}

export interface EstadoOperacion {
  servicios: Servicio[];
  todosDisponibles: boolean;
  verificadoEn: string;
  conectados: { total: number; usuarios: { correo: string; region: string; ultima: string; peticiones: number }[]; regiones: { region: string; conectados: number }[] };
  ultimos15Minutos: ResumenOperacion;
  umbralP95Ms: number;
  alerta: string | null;
  serie: { minuto: string; peticiones: number; p95: number; usuarios: number }[];
  sesionActiva: SesionPilotaje | null;
}

/** Forma del error que devuelve el API. */
export interface ErrorApi {
  codigo: string;
  mensaje: string;
  campos?: Record<string, string>;
  [extra: string]: unknown;
}
