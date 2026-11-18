import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import {
  ConfirmarDialogo, DatosConfirmacion, ETIQUETA_MODALIDAD, FechaPipe, MATERIAL, errorApi, fechaLegible, mensajeDe,
} from '../core/compartido';
import { Entidad, Persona } from '../core/modelos';
import { SesionService } from '../core/sesion.service';

/** CU-02 y CU-03: crear una estrategia o modificarla mientras no tenga estudiantes vinculados. */
@Component({
  selector: 'app-estrategia-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, FechaPipe, ...MATERIAL],
  template: `
    <a class="miga" [routerLink]="id ? ['/estrategias', id] : ['/estrategias']"><mat-icon>arrow_back</mat-icon> Volver</a>
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">{{ id ? 'Modificar estrategia' : 'Nueva estrategia estudiantil' }}</h1>
        <p class="pagina__sub">
          @if (paso() === 'datos') { La entidad se elige del catálogo precargado por el Ministerio; no se escribe a mano. }
          @else { Revise el resumen antes de guardar. }
        </p>
      </div>
    </header>

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><div><strong>No fue posible guardar</strong><p>{{ error() }}</p></div></div>
    }

    <form class="tarjeta" [formGroup]="formulario" (ngSubmit)="revisar()" [hidden]="paso() !== 'datos'">
      <div class="formulario">
        <mat-form-field class="ancho">
          <mat-label>Entidad</mat-label>
          <mat-select formControlName="entidadId">
            @for (e of entidades(); track e.id) {
              <mat-option [value]="e.id">{{ e.nombre }} — {{ e.municipio }} ({{ e.territorio }})</mat-option>
            }
          </mat-select>
          <mat-hint>{{ id ? 'La entidad no se modifica.' : 'Solo aparecen las entidades de su ámbito.' }}</mat-hint>
          <mat-error>{{ errorDe('entidadId') }}</mat-error>
        </mat-form-field>

        <mat-form-field class="ancho">
          <mat-label>Nombre de la estrategia</mat-label>
          <input matInput formControlName="nombre" maxlength="150" />
          <mat-error>{{ errorDe('nombre') }}</mat-error>
        </mat-form-field>

        <mat-form-field class="ancho">
          <mat-label>Objetivo pedagógico</mat-label>
          <textarea matInput formControlName="objetivo" rows="3" maxlength="1000"></textarea>
          <mat-error>{{ errorDe('objetivo') }}</mat-error>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Modalidad</mat-label>
          <mat-select formControlName="modalidad">
            @for (m of modalidades; track m) {<mat-option [value]="m">{{ etiquetaModalidad[m] }}</mat-option>}
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Cupo máximo de estudiantes</mat-label>
          <input matInput type="number" formControlName="cupoMaximo" />
          <mat-error>{{ errorDe('cupoMaximo') }}</mat-error>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Fecha de inicio</mat-label>
          <input matInput type="date" formControlName="fechaInicio" />
          <mat-error>{{ errorDe('fechaInicio') }}</mat-error>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Fecha de finalización</mat-label>
          <input matInput type="date" formControlName="fechaFin" />
          <mat-error>{{ errorDe('fechaFin') }}</mat-error>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Tutores asignados</mat-label>
          <mat-select formControlName="tutorIds" multiple>
            @for (t of tutores(); track t.id) {
              <mat-option [value]="t.id" [disabled]="t.id === yo">{{ t.nombre }}{{ t.id === yo ? ' (usted)' : '' }}</mat-option>
            }
          </mat-select>
          <mat-hint>Tutores habilitados para la entidad. Usted queda asignado.</mat-hint>
          <mat-error>{{ errorDe('tutorIds') }}</mat-error>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Docentes que participan</mat-label>
          <mat-select formControlName="docenteIds" multiple>
            @for (d of docentes(); track d.id) {<mat-option [value]="d.id">{{ d.nombre }} — {{ d.area }}</mat-option>}
          </mat-select>
          <mat-hint>Docentes precargados de la entidad.</mat-hint>
          <mat-error>{{ errorDe('docenteIds') }}</mat-error>
        </mat-form-field>
      </div>

      <div class="acciones">
        <a mat-button [routerLink]="id ? ['/estrategias', id] : ['/estrategias']">Cancelar</a>
        <button mat-flat-button color="primary">Revisar resumen <mat-icon iconPositionEnd>arrow_forward</mat-icon></button>
      </div>
    </form>

    @if (paso() === 'resumen') {
      <section class="tarjeta">
        <h2 class="tarjeta__titulo">Resumen de la estrategia</h2>
        <p class="tarjeta__sub">
          {{ id ? 'Se conservará la versión anterior junto con su usuario y la fecha.' : 'Quedará creada en estado editable, porque todavía no tiene estudiantes vinculados.' }}
        </p>
        <dl class="ficha">
          <div class="ancho"><dt>Nombre</dt><dd>{{ valores.nombre }}</dd></div>
          <div class="ancho"><dt>Entidad</dt><dd>{{ nombreEntidad() }}</dd></div>
          <div class="ancho"><dt>Objetivo pedagógico</dt><dd>{{ valores.objetivo }}</dd></div>
          <div><dt>Modalidad</dt><dd>{{ etiquetaModalidad[valores.modalidad] }}</dd></div>
          <div><dt>Vigencia</dt><dd>{{ valores.fechaInicio | fecha }} a {{ valores.fechaFin | fecha }}</dd></div>
          <div><dt>Cupo máximo</dt><dd>{{ valores.cupoMaximo }} estudiantes</dd></div>
          <div class="ancho"><dt>Tutores asignados</dt><dd>{{ nombres(tutores(), valores.tutorIds) }}</dd></div>
          <div class="ancho"><dt>Docentes que participan</dt><dd>{{ nombres(docentes(), valores.docenteIds) }}</dd></div>
        </dl>
        <div class="acciones">
          <button mat-button type="button" (click)="paso.set('datos')" [disabled]="guardando()"><mat-icon>arrow_back</mat-icon> Corregir</button>
          <button mat-flat-button color="primary" type="button" (click)="guardar()" [disabled]="guardando()">
            <mat-icon>check</mat-icon> {{ guardando() ? 'Guardando…' : 'Confirmar y guardar' }}
          </button>
        </div>
      </section>
    }
  `,
})
export class EstrategiaFormComponent implements OnInit {
  /** Identificador de la estrategia cuando se está modificando (llega desde la ruta). */
  @Input() id?: string;

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);
  readonly yo = inject(SesionService).usuario()?.id ?? 0;

  readonly modalidades = ['PRESENCIAL', 'VIRTUAL', 'MIXTA'];
  readonly etiquetaModalidad = ETIQUETA_MODALIDAD;

  readonly entidades = signal<Entidad[]>([]);
  readonly tutores = signal<Persona[]>([]);
  readonly docentes = signal<Persona[]>([]);
  readonly paso = signal<'datos' | 'resumen'>('datos');
  readonly error = signal('');
  readonly guardando = signal(false);
  private version = 0;

  readonly formulario = inject(FormBuilder).nonNullable.group({
    entidadId: [null as number | null, Validators.required],
    nombre: ['', Validators.required],
    objetivo: ['', Validators.required],
    modalidad: ['PRESENCIAL', Validators.required],
    cupoMaximo: [null as number | null, Validators.required],
    fechaInicio: ['', Validators.required],
    fechaFin: ['', Validators.required],
    tutorIds: [[] as number[]],
    docenteIds: [[] as number[], Validators.required],
  });

  get valores() {
    return this.formulario.getRawValue();
  }

  ngOnInit(): void {
    this.api.entidades().subscribe((entidades) => this.entidades.set(entidades));

    if (this.id) {
      this.formulario.controls.entidadId.disable();
      this.api.estrategia(Number(this.id)).subscribe({
        next: (e) => {
          if (!e.permisos.editar) {
            // La estrategia ya está bloqueada: no se abre en modo edición.
            this.router.navigate(['/estrategias', e.id]);
            return;
          }
          this.version = e.version;
          this.cargarComposicion(e.entidadId, false);
          this.formulario.patchValue({
            entidadId: e.entidadId, nombre: e.nombre, objetivo: e.objetivo, modalidad: e.modalidad,
            cupoMaximo: e.cupoMaximo, fechaInicio: e.fechaInicio, fechaFin: e.fechaFin,
            tutorIds: e.tutores.map((t) => t.id), docenteIds: e.docentes.map((d) => d.id),
          });
        },
        error: (e) => this.error.set(mensajeDe(e)),
      });
    } else {
      this.formulario.controls.entidadId.valueChanges.subscribe((entidadId) => {
        if (entidadId) this.cargarComposicion(entidadId, true);
      });
    }
  }

  /** Al elegir la entidad se cargan sus docentes precargados y los tutores habilitados para ella. */
  private cargarComposicion(entidadId: number, preseleccionar: boolean): void {
    this.api.tutoresDeEntidad(entidadId).subscribe((tutores) => {
      this.tutores.set(tutores);
      if (preseleccionar) this.formulario.controls.tutorIds.setValue([this.yo]);
    });
    this.api.docentesDeEntidad(entidadId).subscribe((docentes) => {
      this.docentes.set(docentes);
      if (preseleccionar) this.formulario.controls.docenteIds.setValue(docentes.map((d) => d.id));
    });
  }

  errorDe(campo: string): string {
    const errores = this.formulario.get(campo)?.errors;
    if (!errores) return '';
    return (errores['servidor'] as string) ?? 'Campo obligatorio';
  }

  nombreEntidad(): string {
    const e = this.entidades().find((x) => x.id === this.valores.entidadId);
    return e ? `${e.nombre} — ${e.municipio} (${e.territorio})` : '';
  }

  nombres(lista: Persona[], ids: number[]): string {
    return lista.filter((p) => ids.includes(p.id)).map((p) => p.nombre).join(', ') || '—';
  }

  revisar(): void {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid) {
      this.error.set('Hay campos obligatorios sin diligenciar. Lo que ya escribió se conserva.');
      return;
    }
    this.error.set('');
    this.paso.set('resumen');
  }

  guardar(confirmarDuplicado = false): void {
    const cuerpo = { ...this.valores, cupoMaximo: Number(this.valores.cupoMaximo), confirmarDuplicado };
    const peticion = this.id
      ? this.api.modificarEstrategia(Number(this.id), { ...cuerpo, version: this.version })
      : this.api.crearEstrategia(cuerpo);

    this.guardando.set(true);
    this.error.set('');
    peticion.subscribe({
      next: (estrategia) => {
        this.avisos.open(
          this.id
            ? `Estrategia ${estrategia.codigo} modificada. Se conservó la versión anterior.`
            : `Estrategia ${estrategia.codigo} creada en estado editable.`,
          'Cerrar',
        );
        this.router.navigate(['/estrategias', estrategia.id]);
      },
      error: (e) => {
        this.guardando.set(false);
        this.atender(e);
      },
    });
  }

  private atender(error: unknown): void {
    const detalle = errorApi(error);

    // CU-02, flujo alterno: la duplicidad se advierte y el usuario decide; no se bloquea.
    if (detalle?.codigo === 'ESTRATEGIA_DUPLICADA') {
      const existente = detalle['existente'] as {
        codigo: string; nombre: string; estado: string; fechaInicio: string; fechaFin: string; cupoMaximo: number; tutores: string[];
      };
      const datos: DatosConfirmacion = {
        titulo: 'Posible estrategia duplicada',
        mensaje: 'Ya existe una estrategia con el mismo nombre en esta entidad. Si se trata de un grupo distinto puede continuar; la advertencia quedará registrada.',
        detalles: [
          `${existente.codigo} · ${existente.nombre}`,
          `Estado: ${existente.estado === 'BLOQUEADA' ? 'bloqueada (con estudiantes)' : 'editable'}`,
          `Vigencia: ${fechaLegible(existente.fechaInicio)} a ${fechaLegible(existente.fechaFin)} · cupo ${existente.cupoMaximo}`,
          `Tutores: ${existente.tutores.join(', ')}`,
        ],
        aceptar: 'Es un grupo distinto, guardar',
        cancelar: 'Cambiar el nombre',
        icono: 'warning',
        tono: 'aviso',
      };
      this.dialogo.open(ConfirmarDialogo, { data: datos, width: '520px' }).afterClosed().subscribe((confirmado) => {
        if (confirmado) this.guardar(true);
        else this.paso.set('datos');
      });
      return;
    }

    if (detalle?.campos) {
      for (const [campo, mensaje] of Object.entries(detalle.campos)) {
        const control = this.formulario.get(campo);
        control?.setErrors({ servidor: mensaje });
        control?.markAsTouched();
      }
    }
    this.error.set(mensajeDe(error));
    this.paso.set('datos');
  }
}
