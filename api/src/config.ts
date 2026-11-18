export const config = {
  puerto: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://sses:sses_dev@localhost:5433/sses',
  jwtSecreto: process.env.JWT_SECRET ?? 'sses-mvp-secreto-solo-para-demo',
  /** RQ_001 pide 30 minutos con refresh token; en el MVP la vigencia es configurable. */
  jwtTtlSegundos: Number(process.env.JWT_TTL_SEGUNDOS ?? 4 * 3600),
  zonaHoraria: process.env.SSES_ZONA_HORARIA ?? 'America/Bogota',
  /** Permite fijar "hoy" (AAAA-MM-DD) para ensayar la demostración en otra fecha. */
  fechaHoyFija: process.env.SSES_FECHA_HOY || null,
  /** RQ_001: bloqueo de la cuenta al quinto intento fallido consecutivo. */
  maxIntentosFallidos: 5,
};
