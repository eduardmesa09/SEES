import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ChipComponent, DatosTexto, MATERIAL, RespuestaTexto, TextoDialogo, Tono, mensajeDe } from '../core/compartido';
import { SolicitudModificacion, SolicitudReapertura } from '../core/modelos';

/**
 * El tutor líder decide lo que los tutores no pueden hacer por su cuenta:
 * reabrir un periodo cerrado (CU-10) y modificar una estrategia bloqueada (CU-03).
 */
@Component({
  selector: 'app-solicitudes',
  standalone: true,
  imports: [DatePipe, RouterLink, ChipComponent, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Solicitudes de los tutores</h1>
        <p class="pagina__sub">Reaperturas de periodos cerrados y modificaciones de estrategias bloqueadas. Mientras usted decide, la información no cambia.</p>
      </div>
    </header>

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    }

    <section class="tarjeta tarjeta--plana">
      <mat-tab-group animationDuration="0ms">
        <mat-tab [label]="'Reaperturas de periodo (' + pendientes(reaperturas()) + ' pendientes)'">
          @if (!reaperturas().length) {
            <div class="vacio"><mat-icon>lock_open</mat-icon><strong>No hay solicitudes de reapertura</strong>Cuando un tutor necesite corregir un periodo cerrado, la solicitud llegará aquí.</div>
          } @else {
            <table class="tabla">
              <thead><tr><th>Estrategia y periodo</th><th>Motivo</th><th>Solicitada por</th><th>Cierre original</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                @for (r of reaperturas(); track r.id) {
                  <tr>
                    <td><strong>{{ r.estrategiaNombre }}</strong><small>{{ r.periodo }} · {{ r.entidadNombre }}</small></td>
                    <td>{{ r.motivo }}</td>
                    <td>{{ r.solicitadoPor }}<small>{{ r.creadoEn | date: 'd MMM y, h:mm a' }}</small></td>
                    <td class="nowrap">
                      {{ r.cerradoEn ? (r.cerradoEn | date: 'd MMM y') : '—' }}
                      @if (r.extemporaneo) {<small class="tono--aviso">Fuera de plazo</small>}
                    </td>
                    <td>
                      <app-chip [tono]="tono(r.estado)" [icono]="icono(r.estado)">{{ etiqueta(r.estado) }}</app-chip>
                      @if (r.respuesta) {<small>{{ r.resueltoPor }}: {{ r.respuesta }}</small>}
                    </td>
                    <td class="derecha">
                      @if (r.estado === 'RADICADA') {<button mat-flat-button color="primary" (click)="decidirReapertura(r)">Decidir</button>}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </mat-tab>

        <mat-tab [label]="'Modificaciones de estrategia (' + pendientes(modificaciones()) + ' pendientes)'">
          @if (!modificaciones().length) {
            <div class="vacio"><mat-icon>assignment</mat-icon><strong>No hay solicitudes de modificación</strong>Llegan cuando un tutor necesita cambiar una estrategia que ya tiene estudiantes.</div>
          } @else {
            <table class="tabla">
              <thead><tr><th>Estrategia</th><th>Cambio solicitado</th><th>Justificación</th><th>Solicitada por</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                @for (s of modificaciones(); track s.id) {
                  <tr>
                    <td><a [routerLink]="['/estrategias', s.estrategiaId]"><strong>{{ s.estrategiaNombre }}</strong></a><small>{{ s.codigo }} · {{ s.entidadNombre }}</small></td>
                    <td>{{ s.cambiosSolicitados }}</td>
                    <td>{{ s.justificacion }}</td>
                    <td>{{ s.solicitadoPor }}<small>{{ s.creadoEn | date: 'd MMM y, h:mm a' }}</small></td>
                    <td>
                      <app-chip [tono]="tono(s.estado)" [icono]="icono(s.estado)">{{ etiqueta(s.estado) }}</app-chip>
                      @if (s.respuesta) {<small>{{ s.resueltoPor }}: {{ s.respuesta }}</small>}
                    </td>
                    <td class="derecha">
                      @if (s.estado === 'RADICADA') {<button mat-flat-button color="primary" (click)="decidirModificacion(s)">Decidir</button>}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </mat-tab>
      </mat-tab-group>
    </section>
  `,
})
export class SolicitudesComponent {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly reaperturas = signal<SolicitudReapertura[]>([]);
  readonly modificaciones = signal<SolicitudModificacion[]>([]);
  readonly error = signal('');

  constructor() {
    this.cargar();
  }

  private cargar(): void {
    this.api.reaperturas().subscribe({ next: (r) => this.reaperturas.set(r), error: (e) => this.error.set(mensajeDe(e)) });
    this.api.solicitudesModificacion().subscribe({ next: (s) => this.modificaciones.set(s), error: (e) => this.error.set(mensajeDe(e)) });
  }

  pendientes(lista: { estado: string }[]): number {
    return lista.filter((x) => x.estado === 'RADICADA').length;
  }

  etiqueta(estado: string): string {
    return { RADICADA: 'Pendiente', APROBADA: 'Aprobada', APLICADA: 'Aprobada y aplicada', RECHAZADA: 'Rechazada' }[estado] ?? estado;
  }
  tono(estado: string): Tono {
    return estado === 'RADICADA' ? 'info' : estado === 'RECHAZADA' ? 'critico' : 'bien';
  }
  icono(estado: string): string {
    return estado === 'RADICADA' ? 'hourglass_top' : estado === 'RECHAZADA' ? 'block' : 'check_circle';
  }

  decidirReapertura(r: SolicitudReapertura): void {
    this.decidir(
      {
        titulo: `Reabrir ${r.periodo} de ${r.estrategiaNombre}`,
        mensaje: 'Si la aprueba, la versión cerrada se conserva, el tutor puede volver a registrar y el periodo queda marcado como corregido.',
        detalles: [`Motivo: ${r.motivo}`, ...(r.justificacionCierre ? [`Justificación del cierre: ${r.justificacionCierre}`] : [])],
        etiqueta: 'Respuesta al tutor', minimo: 5, decision: { aprobar: 'Aprobar reapertura', rechazar: 'Rechazar' },
      },
      (aprobar, respuesta) => this.api.decidirReapertura(r.id, aprobar, respuesta),
    );
  }

  decidirModificacion(s: SolicitudModificacion): void {
    this.decidir(
      {
        titulo: `Modificar ${s.estrategiaNombre}`,
        mensaje: 'Si la aprueba, el tutor podrá editar la estrategia una sola vez. Al guardar, la estrategia vuelve a quedar bloqueada.',
        detalles: [`Cambio solicitado: ${s.cambiosSolicitados}`, `Justificación: ${s.justificacion}`],
        etiqueta: 'Respuesta al tutor', minimo: 5, decision: { aprobar: 'Aprobar modificación', rechazar: 'Rechazar' },
      },
      (aprobar, respuesta) => this.api.decidirModificacion(s.id, aprobar, respuesta),
    );
  }

  private decidir(datos: DatosTexto, enviar: (aprobar: boolean, respuesta: string) => Observable<unknown>): void {
    this.dialogo.open(TextoDialogo, { data: datos, width: '580px' }).afterClosed().subscribe((r?: RespuestaTexto) => {
      if (!r) return;
      enviar(!!r.aprobar, r.texto).subscribe({
        next: () => {
          this.avisos.open(r.aprobar ? 'Solicitud aprobada.' : 'Solicitud rechazada.', 'Cerrar');
          this.cargar();
        },
        error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
      });
    });
  }
}
