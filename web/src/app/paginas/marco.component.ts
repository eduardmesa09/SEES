import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ETIQUETA_PERFIL, MATERIAL } from '../core/compartido';
import { Perfil } from '../core/modelos';
import { SesionService } from '../core/sesion.service';

interface Opcion {
  ruta: string;
  etiqueta: string;
  icono: string;
}

/** El menú se construye según el perfil: las opciones no permitidas se ocultan, no se deshabilitan (CU-01). */
const MENU: Record<Perfil, Opcion[]> = {
  TUTOR: [
    { ruta: '/estrategias', etiqueta: 'Estrategias', icono: 'groups' },
    { ruta: '/acompanamientos', etiqueta: 'Acompañamientos', icono: 'handshake' },
    { ruta: '/seguimiento', etiqueta: 'Seguimiento y cierre', icono: 'date_range' },
    { ruta: '/observaciones', etiqueta: 'Observaciones', icono: 'feedback' },
  ],
  TUTOR_LIDER: [
    { ruta: '/tablero', etiqueta: 'Tablero de cumplimiento', icono: 'insights' },
    { ruta: '/solicitudes', etiqueta: 'Solicitudes', icono: 'inbox' },
    { ruta: '/reportes', etiqueta: 'Reportes de ley', icono: 'verified' },
    { ruta: '/estrategias', etiqueta: 'Estrategias', icono: 'groups' },
  ],
  ENTE_CONTROL: [
    { ruta: '/control', etiqueta: 'Reportes de control', icono: 'policy' },
    { ruta: '/estrategias', etiqueta: 'Estrategias', icono: 'groups' },
  ],
  ADMIN: [
    { ruta: '/usuarios', etiqueta: 'Usuarios', icono: 'manage_accounts' },
    { ruta: '/cargas', etiqueta: 'Cargas masivas', icono: 'upload_file' },
    { ruta: '/auditoria', etiqueta: 'Auditoría', icono: 'fact_check' },
  ],
  SOPORTE: [{ ruta: '/monitoreo', etiqueta: 'Monitoreo', icono: 'monitor_heart' }],
};

@Component({
  selector: 'app-marco',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ...MATERIAL],
  template: `
    <div class="marco">
      <aside class="marco__lateral">
        <div class="marco__marca">
          <div class="marco__sello"><mat-icon>school</mat-icon></div>
          <div><strong>SSES</strong><span>Piloto · MEN</span></div>
        </div>
        <nav class="marco__nav">
          @for (opcion of opciones(); track opcion.ruta) {
            <a class="marco__enlace" [routerLink]="opcion.ruta" routerLinkActive="activo" [attr.aria-label]="opcion.etiqueta">
              <mat-icon>{{ opcion.icono }}</mat-icon><span>{{ opcion.etiqueta }}</span>
              @if (opcion.ruta === '/observaciones' && sinLeer()) {
                <b class="marco__contador" [attr.aria-label]="sinLeer() + ' sin leer'">{{ sinLeer() }}</b>
              }
            </a>
          }
        </nav>
        <div class="marco__usuario">
          <strong>{{ sesion.usuario()?.nombre }}</strong>
          <small>{{ perfil() }}</small>
          <button type="button" class="marco__salir" (click)="salir()" aria-label="Cerrar sesión">
            <mat-icon>logout</mat-icon><span class="texto">Cerrar sesión</span>
          </button>
        </div>
      </aside>
      <main class="marco__contenido">
        @if (sesion.perfil() === 'ENTE_CONTROL') {
          <div class="aviso aviso--info franja-consulta">
            <mat-icon>visibility</mat-icon>
            <div>
              <strong>Perfil de consulta</strong>
              <p>Puede ver y generar reportes, pero no crear, modificar ni eliminar registros. Cada consulta y cada descarga quedan registradas.</p>
            </div>
          </div>
        }
        <router-outlet />
      </main>
    </div>
  `,
})
export class MarcoComponent {
  readonly sesion = inject(SesionService);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);

  readonly sinLeer = signal(0);
  readonly opciones = computed(() => {
    const perfil = this.sesion.perfil();
    return perfil ? MENU[perfil] : [];
  });
  readonly perfil = computed(() => {
    const perfil = this.sesion.perfil();
    return perfil ? ETIQUETA_PERFIL[perfil] : '';
  });

  constructor() {
    // Las observaciones nuevas del tutor líder se avisan en el menú.
    this.contarObservaciones();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.contarObservaciones());
  }

  private contarObservaciones(): void {
    if (this.sesion.perfil() !== 'TUTOR' || this.sesion.usuario()?.debeCambiarContrasena) return;
    this.api.observacionesSinLeer().subscribe({ next: (r) => this.sinLeer.set(r.sinLeer), error: () => undefined });
  }

  salir(): void {
    this.api.salir().subscribe({ error: () => undefined });
    this.sesion.cerrar();
    this.router.navigateByUrl('/login');
  }
}
