/**
 * Oportunidad del registro (RQ_011, indicador de distribución temporal).
 *
 * Es el segundo punto de valor del MVP: con la marca de tiempo del servidor se distingue
 * un seguimiento llevado semana a semana de uno diligenciado de un solo golpe al cierre.
 */
import { diasEntre, sumarDias } from './semanas';

/** Días de gracia, contados desde el domingo de la semana, para reportar el seguimiento. */
export const DIAS_GRACIA_SEGUIMIENTO = 3;
/** Días de gracia, contados desde la fecha del acompañamiento, para registrarlo. */
export const DIAS_GRACIA_ACOMPANAMIENTO = 5;
/** Proporción a partir de la cual un patrón se considera dominante. */
export const UMBRAL_PATRON = 0.6;
/** Últimos días del mes que se consideran "cierre". */
export const DIAS_DE_CIERRE = 3;

export interface Oportunidad {
  oportuno: boolean;
  diasRetraso: number;
}

/** Un seguimiento es oportuno si se registra a más tardar tres días después de terminar su semana. */
export function evaluarSeguimiento(finSemana: string, fechaRegistro: string): Oportunidad {
  const diasRetraso = Math.max(0, diasEntre(finSemana, fechaRegistro));
  return { oportuno: diasRetraso <= DIAS_GRACIA_SEGUIMIENTO, diasRetraso };
}

/** Un acompañamiento es oportuno si se registra a más tardar cinco días después de realizado. */
export function evaluarAcompanamiento(fecha: string, fechaRegistro: string): Oportunidad {
  const diasRetraso = Math.max(0, diasEntre(fecha, fechaRegistro));
  return { oportuno: diasRetraso <= DIAS_GRACIA_ACOMPANAMIENTO, diasRetraso };
}

export type Patron = 'SIN_REGISTROS' | 'SOSTENIDO' | 'CONCENTRADO_AL_CIERRE' | 'IRREGULAR';

export interface RegistroEvaluado {
  oportuno: boolean;
  /** Fecha local (AAAA-MM-DD) en la que el servidor recibió el registro. */
  fechaRegistro: string;
}

/**
 * Clasifica cómo se distribuyeron en el tiempo los registros de un mes:
 * - CONCENTRADO_AL_CIERRE: la mayoría se hizo en los últimos tres días del mes o después.
 * - SOSTENIDO: la mayoría se hizo a tiempo, semana a semana.
 * - IRREGULAR: ni lo uno ni lo otro.
 */
export function patronDeRegistro(registros: RegistroEvaluado[], finDelMes: string): Patron {
  if (registros.length === 0) return 'SIN_REGISTROS';

  const inicioDelCierre = sumarDias(finDelMes, -(DIAS_DE_CIERRE - 1));
  const alCierre = registros.filter((r) => r.fechaRegistro >= inicioDelCierre).length;
  if (registros.length >= 2 && alCierre / registros.length >= UMBRAL_PATRON) {
    return 'CONCENTRADO_AL_CIERRE';
  }

  const oportunos = registros.filter((r) => r.oportuno).length;
  return oportunos / registros.length >= UMBRAL_PATRON ? 'SOSTENIDO' : 'IRREGULAR';
}
