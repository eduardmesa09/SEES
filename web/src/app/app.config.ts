import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localeEsCo from '@angular/common/locales/es-CO';
import { ApplicationConfig, Injectable, LOCALE_ID } from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { interceptorDeSesion } from './core/acceso';
import { interceptorApiEnNavegador } from './core/api-navegador';
import { API_EN_NAVEGADOR } from './core/modo';

registerLocaleData(localeEsCo);

@Injectable()
class PaginadorEnEspanol extends MatPaginatorIntl {
  override itemsPerPageLabel = 'Filas por página';
  override nextPageLabel = 'Página siguiente';
  override previousPageLabel = 'Página anterior';
  override firstPageLabel = 'Primera página';
  override lastPageLabel = 'Última página';
  override getRangeLabel = (pagina: number, tamano: number, total: number) => {
    if (total === 0) return '0 de 0';
    const desde = pagina * tamano + 1;
    return `${desde} – ${Math.min(desde + tamano - 1, total)} de ${total}`;
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    // En GitHub Pages el API corre en el navegador; el interceptor va último para recibir el token.
    provideHttpClient(withInterceptors(API_EN_NAVEGADOR ? [interceptorDeSesion, interceptorApiEnNavegador] : [interceptorDeSesion])),
    provideAnimations(),
    { provide: LOCALE_ID, useValue: 'es-CO' },
    { provide: MatPaginatorIntl, useClass: PaginadorEnEspanol },
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic' } },
    { provide: MAT_SNACK_BAR_DEFAULT_OPTIONS, useValue: { duration: 6000, horizontalPosition: 'end', verticalPosition: 'bottom' } },
  ],
};
