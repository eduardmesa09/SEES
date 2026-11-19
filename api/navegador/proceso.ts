// El API lee `process` (configuración y monitoreo). En el navegador se define lo mínimo que usa.
// Este módulo se importa antes que cualquier otro en entrada.ts.
const inicio = performance.now();
const g = globalThis as unknown as { process?: unknown };
g.process ??= {
  env: {},
  hrtime: { bigint: () => BigInt(Math.round(performance.now() * 1e6)) },
  memoryUsage: () => ({ rss: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0 }),
  uptime: () => (performance.now() - inicio) / 1000,
};
export {};
