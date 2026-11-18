import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ChipComponent, FechaPipe, MATERIAL, MedidorComponent, mensajeDe } from '../core/compartido';
import { Entidad, Estrategia } from '../core/modelos';
import { SesionService } from '../core/sesion.service';

/** CU-04: qué estrategias se están ejecutando, en qué entidades y en qué estado. */
@Component({
  selector: 'app-estrategias-lista',
  standalone: true,
  imports: [FormsModule, RouterLink, ChipComponent, MedidorComponent, FechaPipe, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Estrategias estudiantiles</h1>
        <p class="pagina__sub">
          @if (esTutor) { Estrategias que tiene asignadas. Una estrategia solo puede editarse mientras no tenga estudiantes vinculados. }
          @else if (esControl) { Todas las estrategias del programa en el país, en modo consulta. }
          @else { Estrategias de las entidades de su territorio, en modo consulta. }
        </p>
      </div>
      @if (esTutor) {
        <div class="pagina__acciones">
          <a mat-flat-button color="primary" routerLink="/estrategias/nueva"><mat-icon>add</mat-icon> Nueva estrategia</a>
        </div>
      }
    </header>

    <div class="filtros">
      <mat-form-field class="filtros__amplio">
        <mat-label>Buscar por nombre o código</mat-label>
        <input matInput [(ngModel)]="q" (ngModelChange)="programar()" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Entidad</mat-label>
        <mat-select [(ngModel)]="entidadId" (ngModelChange)="cargar()">
          <mat-option [value]="null">Todas</mat-option>
          @for (e of entidades(); track e.id) {<mat-option [value]="e.id">{{ e.nombre }}</mat-option>}
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Estado</mat-label>
        <mat-select [(ngModel)]="estado" (ngModelChange)="cargar()">
          <mat-option value="">Todos</mat-option>
          <mat-option value="EDITABLE">Editable</mat-option>
          <mat-option value="BLOQUEADA">Bloqueada</mat-option>
        </mat-select>
      </mat-form-field>
    </div>

    <section class="tarjeta tarjeta--plana">
      @if (error()) {
        <div class="vacio"><mat-icon>error</mat-icon><strong>{{ error() }}</strong></div>
      } @else if (cargando()) {
        <div class="cargando">Cargando estrategias…</div>
      } @else if (!estrategias().length) {
        <div class="vacio">
          <mat-icon>groups</mat-icon>
          <strong>No hay estrategias para esta selección</strong>
          Ajuste los filtros{{ esTutor ? ' o cree una nueva estrategia.' : '.' }}
        </div>
      } @else {
        <table class="tabla tabla--clic">
          <thead>
            <tr><th>Estrategia</th><th>Entidad</th><th>Tutores</th><th>Vigencia</th><th>Estudiantes / cupo</th><th>Estado</th></tr>
          </thead>
          <tbody>
            @for (e of estrategias(); track e.id) {
              <tr (click)="abrir(e)">
                <td><strong>{{ e.nombre }}</strong><small class="codigo">{{ e.codigo }}</small></td>
                <td>{{ e.entidadNombre }}<small>{{ e.municipio }} · {{ e.territorio }}</small></td>
                <td>@for (t of e.tutores; track t.id) {<div>{{ t.nombre }}</div>}</td>
                <td class="nowrap">{{ e.fechaInicio | fecha }}<small>a {{ e.fechaFin | fecha }}</small></td>
                <td><app-medidor [valor]="e.vinculados" [total]="e.cupoMaximo" /></td>
                <td>
                  @if (e.estado === 'BLOQUEADA') {
                    <app-chip tono="critico" icono="lock">Bloqueada</app-chip>
                  } @else {
                    <app-chip tono="bien" icono="edit">Editable</app-chip>
                  }
                  @if (e.solicitudesPendientes) {
                    <small>{{ e.solicitudesPendientes }} solicitud(es) de modificación</small>
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
export class EstrategiasListaComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly esTutor = inject(SesionService).perfil() === 'TUTOR';
  readonly esControl = inject(SesionService).perfil() === 'ENTE_CONTROL';

  readonly estrategias = signal<Estrategia[]>([]);
  readonly entidades = signal<Entidad[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  q = '';
  entidadId: number | null = null;
  estado = '';
  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    this.api.entidades().subscribe((entidades) => this.entidades.set(entidades));
    this.cargar();
  }

  programar(): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.cargar(), 250);
  }

  cargar(): void {
    this.api.estrategias({ q: this.q, entidadId: this.entidadId, estado: this.estado }).subscribe({
      next: (estrategias) => {
        this.estrategias.set(estrategias);
        this.cargando.set(false);
        this.error.set('');
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(mensajeDe(e));
      },
    });
  }

  abrir(estrategia: Estrategia): void {
    this.router.navigate(['/estrategias', estrategia.id]);
  }
}
