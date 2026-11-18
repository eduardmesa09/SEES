import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { ChipComponent, MATERIAL, mensajeDe } from '../core/compartido';
import { Observacion } from '../core/modelos';

/** CU-11: observaciones que el tutor líder le dirigió al tutor a partir del tablero. */
@Component({
  selector: 'app-observaciones',
  standalone: true,
  imports: [DatePipe, ChipComponent, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Observaciones del tutor líder</h1>
        <p class="pagina__sub">Lo que el tutor líder observó al revisar su cumplimiento. Cada observación queda registrada con su autor y su fecha.</p>
      </div>
    </header>

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    }

    <section class="tarjeta tarjeta--plana">
      @if (!observaciones().length) {
        <div class="vacio"><mat-icon>feedback</mat-icon><strong>No tiene observaciones</strong>Cuando el tutor líder le haga una, aparecerá aquí.</div>
      } @else {
        <table class="tabla">
          <thead><tr><th>Periodo</th><th>Observación</th><th>Autor</th><th>Fecha</th><th>Estado</th></tr></thead>
          <tbody>
            @for (o of observaciones(); track o.id) {
              <tr>
                <td class="nowrap">{{ o.periodo }}@if (o.estrategiaNombre) {<small>{{ o.estrategiaNombre }}</small>}</td>
                <td>{{ o.texto }}</td>
                <td>{{ o.autor }}</td>
                <td class="nowrap">{{ o.creadoEn | date: 'd MMM y, h:mm a' }}</td>
                <td class="nowrap">
                  @if (o.leidaEn) {
                    <app-chip tono="neutro" icono="done">Leída</app-chip>
                  } @else {
                    <button mat-stroked-button (click)="leer(o)"><mat-icon>mark_email_read</mat-icon> Marcar como leída</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class ObservacionesComponent {
  private readonly api = inject(ApiService);
  readonly observaciones = signal<Observacion[]>([]);
  readonly error = signal('');

  constructor() {
    this.cargar();
  }

  private cargar(): void {
    this.api.observaciones().subscribe({ next: (o) => this.observaciones.set(o), error: (e) => this.error.set(mensajeDe(e)) });
  }

  leer(o: Observacion): void {
    this.api.marcarLeida(o.id).subscribe({ next: () => this.cargar(), error: (e) => this.error.set(mensajeDe(e)) });
  }
}
