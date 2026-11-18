/**
 * Semanas del periodo mensual (RQ_009).
 *
 * Las semanas son semanas ISO 8601 (lunes a domingo, numeración ISO). Una semana
 * pertenece al mes en el que cae su lunes, de modo que cada semana pertenece a un
 * único periodo y los meses resultan de cuatro o de cinco semanas sin configuración
 * manual: febrero de 2026 tiene cuatro y marzo de 2026 tiene cinco.
 *
 * Todas las fechas se manejan como texto AAAA-MM-DD para no depender de la zona horaria.
 */

export interface SemanaIso {
  anioIso: number;
  semanaIso: number;
  /** Lunes de la semana. */
  inicio: string;
  /** Domingo de la semana. */
  fin: string;
}

const MS_POR_DIA = 86_400_000;

export function aUtc(fecha: string): Date {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia));
}

export function aTexto(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function esFechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = aUtc(fecha);
  return !Number.isNaN(d.getTime()) && aTexto(d) === fecha;
}

export function sumarDias(fecha: string, dias: number): string {
  return aTexto(new Date(aUtc(fecha).getTime() + dias * MS_POR_DIA));
}

/** Días transcurridos desde `desde` hasta `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta).getTime() - aUtc(desde).getTime()) / MS_POR_DIA);
}

/** Primer y último día del mes calendario. */
export function rangoDelMes(anio: number, mes: number): { inicio: string; fin: string } {
  const inicio = aTexto(new Date(Date.UTC(anio, mes - 1, 1)));
  const fin = aTexto(new Date(Date.UTC(anio, mes, 0)));
  return { inicio, fin };
}

/** Lunes de la semana a la que pertenece la fecha. */
export function lunesDe(fecha: string): string {
  const diaSemana = aUtc(fecha).getUTCDay() || 7; // 1 = lunes ... 7 = domingo
  return sumarDias(fecha, 1 - diaSemana);
}

/** Año y número de semana ISO 8601 de una fecha. */
export function semanaIsoDe(fecha: string): { anioIso: number; semanaIso: number } {
  const d = aUtc(fecha);
  const diaSemana = d.getUTCDay() || 7;
  // El jueves de la semana determina el año ISO al que pertenece.
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana);
  const anioIso = d.getUTCFullYear();
  const inicioAnio = Date.UTC(anioIso, 0, 1);
  const semanaIso = Math.ceil(((d.getTime() - inicioAnio) / MS_POR_DIA + 1) / 7);
  return { anioIso, semanaIso };
}

/** Semanas ISO que componen el periodo mensual: aquellas cuyo lunes cae dentro del mes. */
export function semanasDelMes(anio: number, mes: number): SemanaIso[] {
  const { inicio, fin } = rangoDelMes(anio, mes);
  let lunes = lunesDe(inicio);
  if (lunes < inicio) lunes = sumarDias(lunes, 7);

  const semanas: SemanaIso[] = [];
  while (lunes <= fin) {
    semanas.push({ ...semanaIsoDe(lunes), inicio: lunes, fin: sumarDias(lunes, 6) });
    lunes = sumarDias(lunes, 7);
  }
  return semanas;
}

/** Mes (periodo) al que pertenece una semana, según la regla del lunes. */
export function periodoDeSemana(inicioSemana: string): { anio: number; mes: number } {
  const [anio, mes] = inicioSemana.split('-').map(Number);
  return { anio, mes };
}

const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function nombreDelMes(anio: number, mes: number): string {
  return `${NOMBRES_MES[mes - 1]} de ${anio}`;
}
