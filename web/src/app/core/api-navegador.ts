import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { NgZone, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** Lo que expone el paquete api-navegador/sses-api.js (ver api/navegador/entrada.ts). */
interface ApiLocal {
  iniciar(): Promise<void>;
  reiniciar(): Promise<void>;
  datosCargadosEl(): string | null;
  atender(p: { method: string; url: string; headers: Record<string, string | null>; body: unknown }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: unknown;
  }>;
}

let api: Promise<ApiLocal> | null = null;

/** Carga el API del navegador una sola vez. Se importa en tiempo de ejecución para no inflar la interfaz. */
export function apiLocal(): Promise<ApiLocal> {
  const importar = new Function('u', 'return import(u)') as (u: string) => Promise<ApiLocal>;
  api ??= importar(new URL('api-navegador/sses-api.js', document.baseURI).href).then(async (m) => {
    await m.iniciar();
    return m;
  });
  return api;
}

/**
 * Versión de GitHub Pages: las peticiones a /api no salen por la red, las atiende el mismo
 * código del API corriendo en el navegador. Para la interfaz es transparente.
 */
export const interceptorApiEnNavegador: HttpInterceptorFn = (peticion, siguiente) => {
  if (!peticion.url.startsWith('/api')) return siguiente(peticion);
  // Las respuestas llegan por promesas nativas (import, Web Locks) que Angular no detecta:
  // se entregan dentro de su zona para que la pantalla se actualice.
  const zona = inject(NgZone);
  return new Observable((destino) => {
    const observador = {
      next: (v: HttpResponse<unknown>) => zona.run(() => destino.next(v)),
      error: (e: unknown) => zona.run(() => destino.error(e)),
      complete: () => zona.run(() => destino.complete()),
    };
    apiLocal()
      .then((a) =>
        a.atender({
          method: peticion.method,
          url: peticion.urlWithParams,
          headers: { authorization: peticion.headers.get('Authorization') },
          body: peticion.body,
        }),
      )
      .then((r) => {
        const headers = new HttpHeaders(r.headers);
        if (r.status >= 400) {
          observador.error(new HttpErrorResponse({ status: r.status, error: r.body, headers, url: peticion.url }));
          return;
        }
        const body =
          peticion.responseType === 'blob'
            ? new Blob([typeof r.body === 'string' ? r.body : JSON.stringify(r.body)], { type: r.headers['content-type'] })
            : peticion.responseType === 'text'
              ? String(r.body)
              : r.body;
        observador.next(new HttpResponse({ status: r.status, body, headers, url: peticion.url }));
        observador.complete();
      })
      .catch((e) => {
        console.error('[sses] API en el navegador', e);
        observador.error(
          new HttpErrorResponse({
            status: 0,
            error: { mensaje: 'No fue posible iniciar la base de datos del navegador. Recargue la página.' },
            url: peticion.url,
          }),
        );
      });
  });
};
