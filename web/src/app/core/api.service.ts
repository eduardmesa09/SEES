import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Acompanamiento, Candidatos, CargaHistorial, Certificado, Credenciales, DetalleSesion, DetalleTablero, DocentesDelPeriodo,
  Entidad, EntidadConCarga, Estrategia, EstrategiaDetalle, EstadoOperacion, Incidente, Listas, Observacion, PaginaAuditoria,
  Periodo, Persona, ReporteDeControl, ReporteDeLey, ResultadoCarga, ResultadoVinculacion, ResumenCierre, Semana,
  SemanasDelPeriodo, SesionPilotaje, SolicitudModificacion, SolicitudReapertura, Cobertura, Tablero, Usuario, UsuarioAdmin,
  Vinculado,
} from './modelos';

type Filtros = Record<string, string | number | null | undefined>;

function parametros(filtros: Filtros): HttpParams {
  let params = new HttpParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor !== null && valor !== undefined && valor !== '') params = params.set(clave, String(valor));
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  // Seguridad
  login(correo: string, contrasena: string) {
    return this.http.post<{ token: string; usuario: Usuario }>(`${this.base}/auth/login`, { correo, contrasena });
  }
  cambiarContrasena(actual: string, nueva: string) {
    return this.http.post<{ token: string; usuario: Usuario }>(`${this.base}/auth/cambiar-contrasena`, { actual, nueva });
  }
  salir() { return this.http.post(`${this.base}/auth/salir`, {}); }

  // Catálogos precargados
  listas() { return this.http.get<Listas>(`${this.base}/catalogos/listas`); }
  entidades() { return this.http.get<Entidad[]>(`${this.base}/catalogos/entidades`); }
  docentesDeEntidad(id: number) { return this.http.get<Persona[]>(`${this.base}/catalogos/entidades/${id}/docentes`); }
  tutoresDeEntidad(id: number) { return this.http.get<Persona[]>(`${this.base}/catalogos/entidades/${id}/tutores`); }
  tutores() { return this.http.get<Persona[]>(`${this.base}/catalogos/tutores`); }
  territorios() { return this.http.get<string[]>(`${this.base}/catalogos/territorios`); }

  // Estrategias
  estrategias(filtros: Filtros = {}) {
    return this.http.get<Estrategia[]>(`${this.base}/estrategias`, { params: parametros(filtros) });
  }
  estrategia(id: number) { return this.http.get<EstrategiaDetalle>(`${this.base}/estrategias/${id}`); }
  crearEstrategia(datos: unknown) { return this.http.post<Estrategia>(`${this.base}/estrategias`, datos); }
  modificarEstrategia(id: number, datos: unknown) { return this.http.put<Estrategia>(`${this.base}/estrategias/${id}`, datos); }
  solicitarModificacion(id: number, datos: { cambiosSolicitados: string; justificacion: string }) {
    return this.http.post(`${this.base}/estrategias/${id}/solicitudes-modificacion`, datos);
  }
  solicitudesModificacion() { return this.http.get<SolicitudModificacion[]>(`${this.base}/solicitudes-modificacion`); }
  decidirModificacion(id: number, aprobar: boolean, respuesta: string) {
    return this.http.post(`${this.base}/solicitudes-modificacion/${id}/decision`, { aprobar, respuesta });
  }

  // Vinculación
  candidatos(id: number, filtros: Filtros) {
    return this.http.get<Candidatos>(`${this.base}/estrategias/${id}/candidatos`, { params: parametros(filtros) });
  }
  vinculados(id: number) { return this.http.get<Vinculado[]>(`${this.base}/estrategias/${id}/vinculaciones`); }
  vincular(id: number, estudianteIds: number[]) {
    return this.http.post<ResultadoVinculacion>(`${this.base}/estrategias/${id}/vinculaciones`, { estudianteIds });
  }
  desvincular(id: number, vinculacionId: number, motivo: string, fecha: string) {
    return this.http.post<{ estudiante: string; vinculados: number; estadoEstrategia: string; desbloqueada: boolean }>(
      `${this.base}/estrategias/${id}/vinculaciones/${vinculacionId}/desvincular`, { motivo, fecha },
    );
  }

  // Periodos, acompañamiento y seguimiento
  periodos(id: number) { return this.http.get<Periodo[]>(`${this.base}/estrategias/${id}/periodos`); }
  docentesDelPeriodo(id: number, anio: number, mes: number) {
    return this.http.get<DocentesDelPeriodo>(`${this.base}/estrategias/${id}/periodos/${anio}/${mes}/docentes`);
  }
  registrarAcompanamiento(id: number, datos: unknown) {
    return this.http.post<Acompanamiento>(`${this.base}/estrategias/${id}/acompanamientos`, datos);
  }
  registrarAcompanamientoGrupal(id: number, datos: unknown) {
    return this.http.post<{ sesionId: number; asistentes: string[]; registros: number; oportuno: boolean; diasRetraso: number }>(
      `${this.base}/estrategias/${id}/acompanamientos/grupales`, datos,
    );
  }
  resumenCierre(id: number, anio: number, mes: number) {
    return this.http.get<ResumenCierre>(`${this.base}/estrategias/${id}/periodos/${anio}/${mes}/cierre`);
  }
  cerrarPeriodo(id: number, anio: number, mes: number, justificacion?: string) {
    return this.http.post<{ extemporaneo: boolean }>(`${this.base}/estrategias/${id}/periodos/${anio}/${mes}/cierre`, { justificacion });
  }
  solicitarReapertura(id: number, anio: number, mes: number, motivo: string) {
    return this.http.post(`${this.base}/estrategias/${id}/periodos/${anio}/${mes}/reapertura`, { motivo });
  }
  reaperturas() { return this.http.get<SolicitudReapertura[]>(`${this.base}/reaperturas`); }
  decidirReapertura(id: number, aprobar: boolean, respuesta: string) {
    return this.http.post(`${this.base}/reaperturas/${id}/decision`, { aprobar, respuesta });
  }
  semanas(id: number, anio: number, mes: number) {
    return this.http.get<SemanasDelPeriodo>(`${this.base}/estrategias/${id}/periodos/${anio}/${mes}/semanas`);
  }
  registrarSeguimiento(id: number, anioIso: number, semanaIso: number, datos: unknown) {
    return this.http.put<{ creado: boolean; semana: Semana; cobertura: Cobertura }>(
      `${this.base}/estrategias/${id}/seguimientos/${anioIso}/${semanaIso}`,
      datos,
    );
  }

  // Tablero
  tablero(filtros: Filtros) { return this.http.get<Tablero>(`${this.base}/tablero`, { params: parametros(filtros) }); }
  detalleTablero(id: number, anio: number, mes: number) {
    return this.http.get<DetalleTablero>(`${this.base}/tablero/estrategias/${id}/${anio}/${mes}`);
  }

  // Observaciones
  observaciones() { return this.http.get<Observacion[]>(`${this.base}/observaciones`); }
  observacionesSinLeer() { return this.http.get<{ sinLeer: number }>(`${this.base}/observaciones/sin-leer`); }
  crearObservacion(datos: { tutorId: number; estrategiaId?: number; anio: number; mes: number; texto: string }) {
    return this.http.post(`${this.base}/observaciones`, datos);
  }
  marcarLeida(id: number) { return this.http.post(`${this.base}/observaciones/${id}/leida`, {}); }

  // Reportes de ley y de control
  reporteDeLey(filtros: Filtros) { return this.http.get<ReporteDeLey>(`${this.base}/reportes/ley`, { params: parametros(filtros) }); }
  descargaReporteDeLey(filtros: Filtros) {
    return this.http.get(`${this.base}/reportes/ley/descarga`, { params: parametros(filtros), responseType: 'blob' });
  }
  certificar(datos: unknown) {
    return this.http.post<{ version: number; codigoVerificacion: string }>(`${this.base}/reportes/ley/certificar`, datos);
  }
  certificados() { return this.http.get<Certificado[]>(`${this.base}/reportes/certificados`); }
  verificar(codigo: string) { return this.http.get<Certificado & { vigente: boolean }>(`${this.base}/reportes/verificar/${encodeURIComponent(codigo)}`); }
  reporteDeControl(filtros: Filtros) { return this.http.get<ReporteDeControl>(`${this.base}/control/reporte`, { params: parametros(filtros) }); }
  descargaReporteDeControl(filtros: Filtros) {
    return this.http.get(`${this.base}/control/reporte/descarga`, { params: parametros(filtros), responseType: 'blob' });
  }

  // Administración
  auditoria(filtros: Filtros) { return this.http.get<PaginaAuditoria>(`${this.base}/auditoria`, { params: parametros(filtros) }); }
  usuarios() { return this.http.get<UsuarioAdmin[]>(`${this.base}/usuarios`); }
  crearUsuario(datos: unknown) { return this.http.post<Credenciales>(`${this.base}/usuarios`, datos); }
  actualizarUsuario(id: number, datos: unknown) { return this.http.put(`${this.base}/usuarios/${id}`, datos); }
  reasignacion(id: number) {
    return this.http.get<{ id: number; codigo: string; nombre: string; entidadNombre: string; candidatos: Persona[] }[]>(`${this.base}/usuarios/${id}/reasignacion`);
  }
  revocar(id: number, motivo: string, reasignaciones: { estrategiaId: number; tutorId: number }[]) {
    return this.http.post(`${this.base}/usuarios/${id}/revocar`, { motivo, reasignaciones });
  }
  reactivar(id: number) { return this.http.post<Credenciales>(`${this.base}/usuarios/${id}/reactivar`, {}); }
  restablecer(id: number) { return this.http.post<Credenciales>(`${this.base}/usuarios/${id}/restablecer`, {}); }
  desbloquear(id: number) { return this.http.post(`${this.base}/usuarios/${id}/desbloquear`, {}); }
  entidadesConCarga() { return this.http.get<EntidadConCarga[]>(`${this.base}/admin/entidades`); }
  cargas() { return this.http.get<CargaHistorial[]>(`${this.base}/cargas`); }
  plantilla(tipo: string) { return this.http.get(`${this.base}/cargas/${tipo}/plantilla`, { responseType: 'blob' }); }
  cargar(tipo: string, archivo: string, contenido: string, consolidarDuplicados = false) {
    return this.http.post<ResultadoCarga>(`${this.base}/cargas/${tipo}`, { archivo, contenido, consolidarDuplicados });
  }

  // Monitoreo del pilotaje
  estadoOperacion() { return this.http.get<EstadoOperacion>(`${this.base}/monitoreo/estado`); }
  sesiones() { return this.http.get<SesionPilotaje[]>(`${this.base}/monitoreo/sesiones`); }
  sesion(id: number) { return this.http.get<DetalleSesion>(`${this.base}/monitoreo/sesiones/${id}`); }
  programarSesion(nombre: string) { return this.http.post<{ id: number }>(`${this.base}/monitoreo/sesiones`, { nombre }); }
  accionSesion(id: number, accion: 'verificacion' | 'inicio' | 'retraso' | 'cierre', cuerpo: unknown = {}) {
    return this.http.post(`${this.base}/monitoreo/sesiones/${id}/${accion}`, cuerpo);
  }
  registrarIncidente(id: number, datos: unknown) { return this.http.post<{ id: number }>(`${this.base}/monitoreo/sesiones/${id}/incidentes`, datos); }
  resolverIncidente(id: number, incidenteId: number) {
    return this.http.post<Incidente>(`${this.base}/monitoreo/sesiones/${id}/incidentes/${incidenteId}/resolucion`, {});
  }
}
