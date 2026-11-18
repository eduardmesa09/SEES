import { DatePipe, JsonPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { ApiService } from '../core/api.service';
import { ChipComponent, MATERIAL, Tono, mensajeDe } from '../core/compartido';
import { PaginaAuditoria, RegistroAuditoria } from '../core/modelos';

@Component({
  selector: 'app-auditoria-detalle',
  standalone: true,
  imports: [DatePipe, JsonPipe, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>{{ r.operacion }} · registro n.º {{ r.id }}</h2>
    <mat-dialog-content>
      <p class="dialogo__mensaje">{{ r.detalle }}</p>
      <dl class="ficha" style="margin: 16px 0">
        <div><dt>Usuario</dt><dd>{{ r.usuarioNombre ?? '—' }}<br /><span class="tenue">{{ r.usuarioCorreo }}</span></dd></div>
        <div><dt>Fecha y hora del servidor</dt><dd>{{ r.fecha | date: 'd MMM y, h:mm:ss a' }}</dd></div>
        <div><dt>Entidad afectada</dt><dd>{{ r.entidadAfectada }} {{ r.registroId ? '· id ' + r.registroId : '' }}<br /><span class="tenue">Origen: {{ r.ip ?? '—' }}</span></dd></div>
      </dl>
      <div class="dos-columnas">
        <div><strong>Valores previos</strong><pre class="json">{{ r.valoresPrevios ? (r.valoresPrevios | json) : '—' }}</pre></div>
        <div><strong>Valores nuevos</strong><pre class="json">{{ r.valoresNuevos ? (r.valoresNuevos | json) : '—' }}</pre></div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-flat-button color="primary" mat-dialog-close>Cerrar</button></mat-dialog-actions>
  `,
})
export class AuditoriaDetalleDialogo {
  readonly r = inject<RegistroAuditoria>(MAT_DIALOG_DATA);
}

const RECHAZOS = ['ACCESO_DENEGADO', 'EDICION_RECHAZADA', 'ACOMPANAMIENTO_RECHAZADO', 'LOGIN_FALLIDO', 'LOGIN_RECHAZADO', 'CUENTA_BLOQUEADA'];

/** RQ_017: bitácora de solo anexado. Quién hizo qué, cuándo y con qué valores previos. */
@Component({
  selector: 'app-auditoria',
  standalone: true,
  imports: [DatePipe, FormsModule, ChipComponent, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Auditoría</h1>
        <p class="pagina__sub">Bitácora de solo anexado: ningún perfil puede modificarla ni borrarla. Registra accesos, creaciones, modificaciones y también los intentos rechazados.</p>
      </div>
      <div class="pagina__acciones"><button mat-stroked-button (click)="cargar(1)"><mat-icon>refresh</mat-icon> Actualizar</button></div>
    </header>

    <div class="filtros">
      <mat-form-field class="filtros__amplio">
        <mat-label>Operación</mat-label>
        <mat-select [(ngModel)]="operacion" (ngModelChange)="cargar(1)">
          <mat-option value="">Todas</mat-option>
          @for (o of pagina()?.operaciones ?? []; track o) {<mat-option [value]="o">{{ o }}</mat-option>}
        </mat-select>
      </mat-form-field>
      <mat-form-field class="filtros__amplio">
        <mat-label>Usuario o detalle</mat-label>
        <input matInput [(ngModel)]="q" (ngModelChange)="programar()" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
    </div>

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    }

    <section class="tarjeta tarjeta--plana">
      @if (pagina(); as p) {
        <table class="tabla tabla--compacta tabla--clic">
          <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Operación</th><th>Detalle</th><th>Origen</th></tr></thead>
          <tbody>
            @for (r of p.registros; track r.id) {
              <tr (click)="ver(r)">
                <td class="nowrap mono">{{ r.fecha | date: 'd MMM y, h:mm:ss a' }}</td>
                <td>{{ r.usuarioNombre ?? '—' }}<small>{{ r.usuarioCorreo }}</small></td>
                <td><app-chip [tono]="tono(r)" [icono]="icono(r)">{{ r.operacion }}</app-chip></td>
                <td>{{ r.detalle }}</td>
                <td class="tenue mono">{{ r.ip }}</td>
              </tr>
            }
          </tbody>
        </table>
        <mat-paginator [length]="p.total" [pageIndex]="p.pagina - 1" [pageSize]="tamano" [pageSizeOptions]="[25, 50, 100]"
                       (page)="paginar($event)" showFirstLastButtons />
      } @else {
        <div class="cargando">Cargando bitácora…</div>
      }
    </section>
  `,
})
export class AuditoriaComponent {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);

  readonly pagina = signal<PaginaAuditoria | null>(null);
  readonly error = signal('');
  operacion = '';
  q = '';
  tamano = 25;
  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    this.cargar(1);
  }

  programar(): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cargar(1), 250);
  }

  cargar(pagina: number): void {
    this.api.auditoria({ operacion: this.operacion, q: this.q, pagina, tamano: this.tamano }).subscribe({
      next: (p) => {
        this.pagina.set(p);
        this.error.set('');
      },
      error: (e) => this.error.set(mensajeDe(e)),
    });
  }

  paginar(evento: PageEvent): void {
    this.tamano = evento.pageSize;
    this.cargar(evento.pageIndex + 1);
  }

  tono(r: RegistroAuditoria): Tono {
    if (RECHAZOS.includes(r.operacion)) return 'critico';
    if (r.operacion === 'BLOQUEAR_ESTRATEGIA') return 'aviso';
    return 'neutro';
  }

  icono(r: RegistroAuditoria): string {
    if (RECHAZOS.includes(r.operacion)) return 'block';
    if (r.operacion === 'BLOQUEAR_ESTRATEGIA') return 'lock';
    if (r.operacion.startsWith('LOGIN')) return 'login';
    return 'edit_note';
  }

  ver(registro: RegistroAuditoria): void {
    this.dialogo.open(AuditoriaDetalleDialogo, { data: registro, width: '860px', maxWidth: '95vw' });
  }
}
