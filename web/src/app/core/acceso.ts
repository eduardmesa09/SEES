import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Perfil } from './modelos';
import { SesionService } from './sesion.service';

/** Adjunta el token a cada petición y devuelve al ingreso cuando la sesión vence. */
export const interceptorDeSesion: HttpInterceptorFn = (peticion, siguiente) => {
  const sesion = inject(SesionService);
  const router = inject(Router);
  const conToken = sesion.token ? peticion.clone({ setHeaders: { Authorization: `Bearer ${sesion.token}` } }) : peticion;

  return siguiente(conToken).pipe(
    catchError((error: HttpErrorResponse) => {
      // Sesión vencida o revocada por el administrador: se vuelve al ingreso.
      if (error.status === 401 && !peticion.url.endsWith('/auth/login')) {
        sesion.cerrar();
        router.navigateByUrl('/login');
      }
      return throwError(() => error);
    }),
  );
};

export const conSesion: CanActivateFn = () => {
  const sesion = inject(SesionService);
  return sesion.usuario() ? true : inject(Router).parseUrl('/login');
};

/** CU-01: con credenciales de activación, lo primero es definir la contraseña propia. */
export const contrasenaDefinida: CanActivateFn = () => {
  const sesion = inject(SesionService);
  return sesion.usuario()?.debeCambiarContrasena ? inject(Router).parseUrl('/cambiar-contrasena') : true;
};

/**
 * La interfaz solo muestra las opciones del perfil. Es una comodidad, no el control:
 * la autorización real la resuelve el servidor en cada petición.
 */
export function paraPerfil(...perfiles: Perfil[]): CanActivateFn {
  return () => {
    const sesion = inject(SesionService);
    const perfil = sesion.perfil();
    if (perfil && perfiles.includes(perfil)) return true;
    return inject(Router).parseUrl(sesion.rutaInicial());
  };
}
