import { Injectable, computed, signal } from '@angular/core';
import { Usuario } from './modelos';

const CLAVE = 'sses.sesion';

/**
 * Sesión del usuario. Se guarda en sessionStorage, que es propio de cada pestaña:
 * permite tener abiertos a la vez un tutor, un tutor líder y un administrador.
 */
@Injectable({ providedIn: 'root' })
export class SesionService {
  readonly usuario = signal<Usuario | null>(null);
  readonly perfil = computed(() => this.usuario()?.perfil ?? null);
  token: string | null = null;

  constructor() {
    try {
      const guardada = sessionStorage.getItem(CLAVE);
      if (guardada) {
        const { token, usuario } = JSON.parse(guardada);
        this.token = token;
        this.usuario.set(usuario);
      }
    } catch {
      this.cerrar();
    }
  }

  iniciar(token: string, usuario: Usuario): void {
    this.token = token;
    this.usuario.set(usuario);
    sessionStorage.setItem(CLAVE, JSON.stringify({ token, usuario }));
  }

  cerrar(): void {
    this.token = null;
    this.usuario.set(null);
    sessionStorage.removeItem(CLAVE);
  }

  /** Pantalla de entrada según el perfil. Con credenciales de activación, primero la contraseña. */
  rutaInicial(): string {
    if (this.usuario()?.debeCambiarContrasena) return '/cambiar-contrasena';
    switch (this.perfil()) {
      case 'TUTOR': return '/estrategias';
      case 'TUTOR_LIDER': return '/tablero';
      case 'ENTE_CONTROL': return '/control';
      case 'ADMIN': return '/usuarios';
      case 'SOPORTE': return '/monitoreo';
      default: return '/login';
    }
  }
}
