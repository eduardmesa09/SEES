import { AppError } from '../errores';
import { config } from '../config';
import { esFechaValida } from './semanas';

const formatoFechaLocal = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.zonaHoraria,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha local (AAAA-MM-DD) de un instante, en la zona horaria del Piloto. */
export function fechaLocal(instante: Date): string {
  return formatoFechaLocal.format(instante);
}

/** Fecha de hoy según el servidor: nunca se confía en la fecha del cliente. */
export function hoy(): string {
  return config.fechaHoyFija ?? fechaLocal(new Date());
}

/** Texto sin tildes, en minúsculas y sin espacios repetidos: base de la comparación normalizada. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** RQ_003: la fecha de finalización debe ser posterior a la de inicio. */
export function validarRangoDeFechas(fechaInicio: string, fechaFin: string): void {
  if (!esFechaValida(fechaInicio) || !esFechaValida(fechaFin)) {
    throw new AppError(400, 'FECHA_INVALIDA', 'Las fechas de inicio y finalización deben ser fechas válidas.');
  }
  if (fechaFin <= fechaInicio) {
    throw new AppError(
      400,
      'RANGO_DE_FECHAS_INVALIDO',
      'La fecha de finalización debe ser posterior a la fecha de inicio: una estrategia sin duración impide calcular los periodos mensuales de acompañamiento.',
      { campos: { fechaFin: 'Debe ser posterior a la fecha de inicio' } },
    );
  }
}

/** RQ_003: el cupo máximo debe ser mayor que cero. */
export function validarCupo(cupoMaximo: number): void {
  if (!Number.isInteger(cupoMaximo) || cupoMaximo <= 0) {
    throw new AppError(400, 'CUPO_INVALIDO', 'El cupo máximo debe ser un número entero mayor que cero.', {
      campos: { cupoMaximo: 'Debe ser mayor que cero' },
    });
  }
}

export const MODALIDADES = ['PRESENCIAL', 'VIRTUAL', 'MIXTA'] as const;

/** Lista controlada de causas para una semana sin actividad (CU-09). */
export const CAUSAS_INACTIVIDAD = [
  'Receso institucional',
  'Situación de orden público',
  'Ausencia justificada del tutor',
  'Jornada institucional o evaluaciones',
  'Emergencia climática o de acceso',
] as const;

/** Lista controlada de motivos de desvinculación (CU-06): permite agrupar y analizar los retiros. */
export const MOTIVOS_DESVINCULACION = [
  'Retiro voluntario del estudiante',
  'Traslado a otra institución',
  'Cruce de horario con otras actividades',
  'Bajo rendimiento o inasistencia reiterada',
  'Situación familiar o de salud',
] as const;

/** Días, contados desde el último día del mes, para cerrar el periodo dentro del plazo (CU-10). */
export const DIAS_PLAZO_CIERRE = 5;
