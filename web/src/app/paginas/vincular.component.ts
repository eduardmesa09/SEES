import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ChipComponent, ConfirmarDialogo, DatosConfirmacion, MATERIAL, MedidorComponent, errorApi, mensajeDe } from '../core/compartido';
import { Candidatos, Estudiante, ResultadoVinculacion } from '../core/modelos';

/** Resultado de la vinculación: informa de forma explícita el cambio de estado de la estrategia. */
@Component({
  selector: 'app-resultado-vinculacion',
  standalone: true,
  imports: [ChipComponent, ...MATERIAL],
  template: `
    <h2 mat-dialog-title class="dialogo__titulo"><mat-icon class="tono--bien">check_circle</mat-icon> Vinculación registrada</h2>
    <mat-dialog-content>
      <p><strong>{{ r.vinculados.length }}</strong> estudiante(s) vinculado(s) el día de hoy. La estrategia tiene ahora
        <strong>{{ r.totalVinculados }}</strong> de {{ r.cupoMaximo }} cupos ocupados.</p>

      @if (r.descartados.length) {
        <div class="aviso aviso--aviso" style="margin-top: 14px">
          <mat-icon>warning</mat-icon>
          <div>
            <strong>{{ r.descartados.length }} descartado(s) por estar ya vinculados</strong>
            <p>{{ descartados }}</p>
          </div>
        </div>
      }

      @if (r.bloqueoAplicado) {
        <div class="aviso aviso--neutro" style="margin-top: 14px; margin-bottom: 0">
          <mat-icon>lock</mat-icon>
          <div>
            <strong>La estrategia quedó bloqueada para edición</strong>
            <div class="cambio-estado">
              <app-chip tono="bien" icono="edit">Editable</app-chip>
              <mat-icon>arrow_forward</mat-icon>
              <app-chip tono="neutro" icono="lock">Edición bloqueada</app-chip>
            </div>
            <p>Ya tiene participantes: desde ahora cualquier ajuste estructural requiere una solicitud de modificación.</p>
          </div>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button color="primary" mat-dialog-close cdkFocusInitial>Ver la estrategia</button>
    </mat-dialog-actions>
  `,
})
export class ResultadoVinculacionDialogo {
  readonly r = inject<ResultadoVinculacion>(MAT_DIALOG_DATA);
  readonly descartados = this.r.descartados.map((d) => d.nombre).join(', ');
}

/** CU-05: el grupo se conforma buscando entre los estudiantes precargados; el Piloto no crea estudiantes. */
@Component({
  selector: 'app-vincular',
  standalone: true,
  imports: [FormsModule, RouterLink, ChipComponent, MedidorComponent, ...MATERIAL],
  template: `
    <a class="miga" [routerLink]="['/estrategias', id]"><mat-icon>arrow_back</mat-icon> Volver a la estrategia</a>

    @if (datos(); as d) {
      <header class="pagina__encabezado">
        <div>
          <h1 class="pagina__titulo">Vincular estudiantes</h1>
          <p class="pagina__sub">
            {{ d.estrategia.nombre }} <span class="codigo">· {{ d.estrategia.codigo }}</span> · {{ d.estrategia.entidadNombre }}
          </p>
        </div>
        <div style="width: 240px"><app-medidor [valor]="d.estrategia.vinculados" [total]="d.estrategia.cupoMaximo" /></div>
      </header>

      @if (d.estrategia.vencida) {
        <div class="aviso aviso--critico"><mat-icon>event_busy</mat-icon><div><strong>La estrategia ya finalizó</strong><p>No admite nuevas vinculaciones.</p></div></div>
      } @else if (d.estrategia.estado === 'EDITABLE') {
        <div class="aviso aviso--aviso">
          <mat-icon>lock_open</mat-icon>
          <div><strong>Esta será la primera vinculación</strong><p>Al confirmar, la estrategia quedará bloqueada para edición.</p></div>
        </div>
      }
      @if (d.cargaPendiente) {
        <div class="aviso aviso--aviso"><mat-icon>cloud_off</mat-icon><div><strong>La carga de estudiantes de esta entidad aún no se ha ejecutado</strong><p>Solicítela al administrador del sistema.</p></div></div>
      }

      <div class="filtros">
        <mat-form-field class="filtros__amplio">
          <mat-label>Documento o nombre</mat-label>
          <input matInput [(ngModel)]="q" (ngModelChange)="programar()" />
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Grado</mat-label>
          <mat-select [(ngModel)]="grado" (ngModelChange)="buscar(1)">
            <mat-option value="">Todos</mat-option>
            @for (g of d.grados; track g) {<mat-option [value]="g">{{ g }}</mat-option>}
          </mat-select>
        </mat-form-field>
        <span class="secundario">{{ d.total }} estudiante(s) precargado(s) coinciden</span>
      </div>

      <section class="tarjeta tarjeta--plana">
        @if (!d.estudiantes.length) {
          <div class="vacio">
            <mat-icon>search_off</mat-icon>
            <strong>No se encontró ningún estudiante precargado</strong>
            El Piloto no permite crear estudiantes nuevos. Si falta alguno, solicite la carga al administrador.
          </div>
        } @else {
          <table class="tabla tabla--compacta">
            <thead>
              <tr>
                <th style="width: 56px">
                  <mat-checkbox [checked]="paginaCompleta()" [indeterminate]="paginaParcial()" (change)="alternarPagina($event.checked)"
                                aria-label="Seleccionar todos los de esta página" />
                </th>
                <th>Documento</th><th>Estudiante</th><th>Grado</th><th>Situación</th>
              </tr>
            </thead>
            <tbody>
              @for (s of d.estudiantes; track s.id) {
                <tr>
                  <td><mat-checkbox [checked]="seleccion().has(s.id)" (change)="alternar(s, $event.checked)" [attr.aria-label]="'Seleccionar a ' + s.nombres" /></td>
                  <td class="mono">{{ s.tipoDocumento }} {{ s.documento }}</td>
                  <td>{{ s.apellidos }}, {{ s.nombres }}</td>
                  <td>{{ s.grado }}</td>
                  <td>@if (s.yaVinculado) {<app-chip tono="info" icono="link">Ya vinculado</app-chip>} @else {<span class="tenue">Disponible</span>}</td>
                </tr>
              }
            </tbody>
          </table>
        }
        <mat-paginator [length]="d.total" [pageIndex]="d.pagina - 1" [pageSize]="tamano" [pageSizeOptions]="[10, 25, 50]"
                       (page)="paginar($event)" showFirstLastButtons />
      </section>

      @if (seleccion().size) {
        <div class="barra-seleccion">
          <div>
            <strong>{{ seleccion().size }} estudiante(s) seleccionado(s)</strong>
            <small>
              @if (seleccion().size > d.estrategia.cupoDisponible) {
                La selección supera los {{ d.estrategia.cupoDisponible }} cupo(s) disponibles; el servidor la rechazará.
              } @else {
                Quedan {{ d.estrategia.cupoDisponible }} cupo(s) disponibles.
              }
            </small>
          </div>
          <div>
            <button mat-button style="color: #fff" (click)="limpiar()">Quitar selección</button>
            <button mat-flat-button (click)="confirmar(d)" [disabled]="enviando() || d.estrategia.vencida">
              <mat-icon>person_add</mat-icon> Vincular seleccionados
            </button>
          </div>
        </div>
      }
    } @else if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    } @else {
      <div class="cargando">Cargando estudiantes precargados…</div>
    }
  `,
})
export class VincularComponent implements OnInit {
  @Input({ required: true }) id!: string;

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly dialogo = inject(MatDialog);

  readonly datos = signal<Candidatos | null>(null);
  readonly seleccion = signal(new Map<number, Estudiante>());
  readonly error = signal('');
  readonly enviando = signal(false);

  readonly paginaCompleta = computed(() => {
    const d = this.datos();
    return !!d?.estudiantes.length && d.estudiantes.every((s) => this.seleccion().has(s.id));
  });
  readonly paginaParcial = computed(() => {
    const d = this.datos();
    return !this.paginaCompleta() && !!d?.estudiantes.some((s) => this.seleccion().has(s.id));
  });

  q = '';
  grado = '';
  tamano = 25;
  private temporizador?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.buscar(1);
  }

  programar(): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.buscar(1), 250);
  }

  buscar(pagina: number): void {
    this.api.candidatos(Number(this.id), { q: this.q, grado: this.grado, pagina, tamano: this.tamano }).subscribe({
      next: (d) => this.datos.set(d),
      error: (e) => this.error.set(mensajeDe(e)),
    });
  }

  paginar(evento: PageEvent): void {
    this.tamano = evento.pageSize;
    this.buscar(evento.pageIndex + 1);
  }

  alternar(estudiante: Estudiante, marcado: boolean): void {
    const nueva = new Map(this.seleccion());
    if (marcado) nueva.set(estudiante.id, estudiante);
    else nueva.delete(estudiante.id);
    this.seleccion.set(nueva);
  }

  /** Selección en bloque: útil para vincular un curso completo filtrando por grado. */
  alternarPagina(marcado: boolean): void {
    const nueva = new Map(this.seleccion());
    for (const s of this.datos()?.estudiantes ?? []) {
      if (marcado) nueva.set(s.id, s);
      else nueva.delete(s.id);
    }
    this.seleccion.set(nueva);
  }

  limpiar(): void {
    this.seleccion.set(new Map());
  }

  confirmar(d: Candidatos): void {
    const cantidad = this.seleccion().size;
    const datos: DatosConfirmacion = {
      titulo: `Vincular ${cantidad} estudiante(s)`,
      mensaje:
        d.estrategia.estado === 'EDITABLE'
          ? 'Es la primera vinculación de la estrategia. Al confirmar quedará bloqueada para edición: sus datos estructurales ya no podrán cambiarse sin una solicitud.'
          : 'Los estudiantes quedarán vinculados con la fecha de hoy.',
      aceptar: 'Confirmar vinculación',
      icono: d.estrategia.estado === 'EDITABLE' ? 'lock' : 'person_add',
      tono: d.estrategia.estado === 'EDITABLE' ? 'critico' : 'info',
    };
    this.dialogo.open(ConfirmarDialogo, { data: datos, width: '500px' }).afterClosed().subscribe((ok) => {
      if (ok) this.vincular();
    });
  }

  private vincular(): void {
    this.enviando.set(true);
    this.api.vincular(Number(this.id), [...this.seleccion().keys()]).subscribe({
      next: (resultado) => {
        this.dialogo.open(ResultadoVinculacionDialogo, { data: resultado, width: '540px' }).afterClosed().subscribe(() => {
          this.router.navigate(['/estrategias', this.id]);
        });
      },
      error: (e) => {
        this.enviando.set(false);
        const detalle = errorApi(e);
        const datos: DatosConfirmacion = {
          titulo: detalle?.codigo === 'CUPO_EXCEDIDO' ? 'La selección supera el cupo' : 'No fue posible vincular',
          mensaje: mensajeDe(e),
          detalles: ['No se vinculó a ningún estudiante: la operación se ejecuta completa o no se ejecuta.'],
          aceptar: 'Ajustar la selección',
          cancelar: null,
          icono: 'error',
          tono: 'critico',
        };
        this.dialogo.open(ConfirmarDialogo, { data: datos, width: '520px' });
      },
    });
  }
}
