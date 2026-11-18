/**
 * Cobertura del seguimiento semanal (RQ_009): semanas reportadas sobre semanas esperadas.
 * Una semana reportada "sin actividad" cuenta como reportada; una semana en blanco no.
 */
export interface Cobertura {
  reportadas: number;
  esperadas: number;
  porcentaje: number;
}

export function calcularCobertura(reportadas: number, esperadas: number): Cobertura {
  if (esperadas <= 0) return { reportadas, esperadas: 0, porcentaje: 0 };
  return { reportadas, esperadas, porcentaje: Math.round((reportadas * 100) / esperadas) };
}

export function porcentaje(parte: number, total: number): number {
  return total > 0 ? Math.round((parte * 100) / total) : 0;
}
