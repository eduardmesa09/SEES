import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../core/api.service';
import { ChipComponent, ETIQUETA_MODALIDAD, FechaPipe, MATERIAL, MedidorComponent, errorApi, mensajeDe } from '../core/compartido';
import { Acompanamiento, DocenteDelPeriodo, DocentesDelPeriodo, Persona } from '../core/modelos';
import { SeleccionDePeriodo, SelectorPeriodoComponent } from '../core/selector-periodo';

interface DatosDialogo {
  estrategiaId: number;
  anio: number;
  mes: number;
  periodo: string;
  docente: DocenteDelPeriodo;
  rangoValido: { desde: string; hasta: string };
}

/** CU-07: formulario del acompañamiento pedagógico individual. */
@Component({
  selector: 'app-acompanamiento-dialogo',
  standalone: true,
  imports: [ReactiveFormsModule, FechaPipe, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>Acompañamiento a {{ datos.docente.nombre }}</h2>
    <mat-dialog-content>
      <p class="dialogo__mensaje">{{ datos.docente.area }} · periodo {{ datos.periodo }}</p>

      @if (error()) {
        <div class="aviso aviso--{{ duplicado() ? 'aviso' : 'critico' }} dialogo__error" style="margin-top: 12px">
          <mat-icon>{{ duplicado() ? 'warning' : 'error' }}</mat-icon>
          <div>
            <p>{{ error() }}</p>
            @if (duplicado()) {
              <div class="aviso__acciones">
                <button mat-stroked-button type="button" (click)="guardar(true)">Registrar como sesión adicional del mismo periodo</button>
              </div>
            }
          </div>
        </div>
      }

      @if (datos.docente.compromisosAnteriores; as anterior) {
        <div class="cita" style="margin-top: 12px">
          <small>Compromisos del acompañamiento anterior ({{ anterior.fecha | fecha }} · {{ anterior.tema }})</small>
          {{ anterior.compromisos }}
        </div>
      }

      <form class="formulario" [formGroup]="formulario" style="margin-top: 14px">
        <mat-form-field>
          <mat-label>Fecha en que se realizó</mat-label>
          <input matInput type="date" formControlName="fecha" [min]="datos.rangoValido.desde" [max]="datos.rangoValido.hasta" />
          <mat-hint>Entre el {{ datos.rangoValido.desde | fecha: 'corta' }} y el {{ datos.rangoValido.hasta | fecha: 'corta' }}</mat-hint>
          <mat-error>{{ errorDe('fecha') }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Modalidad</mat-label>
          <mat-select formControlName="modalidad">
            @for (m of modalidades; track m) {<mat-option [value]="m">{{ etiquetaModalidad[m] }}</mat-option>}
          </mat-select>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Tema o línea pedagógica</mat-label>
          <input matInput formControlName="tema" maxlength="200" />
          <mat-error>{{ errorDe('tema') }}</mat-error>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Observaciones sobre el desarrollo de la sesión</mat-label>
          <textarea matInput formControlName="observaciones" rows="3"></textarea>
          <mat-error>{{ errorDe('observaciones') }}</mat-error>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Compromisos acordados con el docente</mat-label>
          <textarea matInput formControlName="compromisos" rows="2"></textarea>
          <mat-error>{{ errorDe('compromisos') }}</mat-error>
        </mat-form-field>
        @if (datos.docente.compromisosAnteriores) {
          <mat-form-field class="ancho">
            <mat-label>Avance sobre los compromisos anteriores</mat-label>
            <textarea matInput formControlName="avanceCompromisos" rows="2"></textarea>
          </mat-form-field>
        }
      </form>
      <p class="tenue" style="font-size: 12.5px">La fecha y la hora del registro las asigna el servidor: con ellas se mide si el registro fue oportuno.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="guardando()">Guardar acompañamiento</button>
    </mat-dialog-actions>
  `,
})
export class AcompanamientoDialogo {
  readonly datos = inject<DatosDialogo>(MAT_DIALOG_DATA);
  private readonly api = inject(ApiService);
  private readonly ref = inject(MatDialogRef<AcompanamientoDialogo>);

  readonly modalidades = ['PRESENCIAL', 'VIRTUAL', 'MIXTA'];
  readonly etiquetaModalidad = ETIQUETA_MODALIDAD;
  readonly error = signal('');
  readonly duplicado = signal(false);
  readonly guardando = signal(false);

  readonly formulario = inject(FormBuilder).nonNullable.group({
    fecha: [this.datos.rangoValido.hasta, Validators.required],
    modalidad: ['PRESENCIAL', Validators.required],
    tema: ['', Validators.required],
    observaciones: ['', Validators.required],
    compromisos: ['', Validators.required],
    avanceCompromisos: [''],
  });

  errorDe(campo: string): string {
    const errores = this.formulario.get(campo)?.errors;
    if (!errores) return '';
    return (errores['servidor'] as string) ?? 'Campo obligatorio';
  }

  guardar(confirmarAdicional = false): void {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid) return;

    this.guardando.set(true);
    this.error.set('');
    this.duplicado.set(false);
    const cuerpo = {
      ...this.formulario.getRawValue(),
      anio: this.datos.anio,
      mes: this.datos.mes,
      docenteId: this.datos.docente.id,
      confirmarAdicional,
    };
    this.api.registrarAcompanamiento(this.datos.estrategiaId, cuerpo).subscribe({
      next: (registro) => this.ref.close(registro),
      error: (e) => {
        this.guardando.set(false);
        const detalle = errorApi(e);
        this.duplicado.set(detalle?.codigo === 'ACOMPANAMIENTO_EXISTENTE');
        if (detalle?.campos) {
          for (const [campo, mensaje] of Object.entries(detalle.campos)) {
            const control = this.formulario.get(campo);
            control?.setErrors({ servidor: mensaje });
            control?.markAsTouched();
          }
        }
        this.error.set(mensajeDe(e));
      },
    });
  }
}

interface DatosGrupal {
  estrategiaId: number;
  anio: number;
  mes: number;
  periodo: string;
  docentes: Persona[];
  rangoValido: { desde: string; hasta: string };
}

/** CU-08: una jornada colectiva genera un acompañamiento por cada docente que asistió. */
@Component({
  selector: 'app-grupal-dialogo',
  standalone: true,
  imports: [ReactiveFormsModule, FechaPipe, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>Sesión grupal · {{ datos.periodo }}</h2>
    <mat-dialog-content>
      <p class="dialogo__mensaje">Marque los docentes que asistieron. Se genera un acompañamiento para cada uno; los no marcados no reciben registro.</p>
      @if (error()) {
        <div class="aviso aviso--{{ coincidencia() ? 'aviso' : 'critico' }}" style="margin-top: 12px">
          <mat-icon>{{ coincidencia() ? 'warning' : 'error' }}</mat-icon>
          <div>
            <p>{{ error() }}</p>
            @if (coincidencia()) {
              <div class="aviso__acciones"><button mat-stroked-button type="button" (click)="guardar(true)">Sí, es otra jornada</button></div>
            }
          </div>
        </div>
      }
      <div class="asistentes" style="margin-top: 12px">
        @for (d of datos.docentes; track d.id) {
          <mat-checkbox [checked]="marcados.has(d.id)" (change)="alternar(d.id)">{{ d.nombre }} <span class="tenue">· {{ d.area }}</span></mat-checkbox>
        }
      </div>
      <p class="tenue" style="font-size: 12.5px; margin: 4px 0 12px">{{ marcados.size }} asistente(s). Se requieren al menos dos.</p>
      <form class="formulario" [formGroup]="formulario">
        <mat-form-field>
          <mat-label>Fecha de la jornada</mat-label>
          <input matInput type="date" formControlName="fecha" [min]="datos.rangoValido.desde" [max]="datos.rangoValido.hasta" />
          <mat-hint>Entre el {{ datos.rangoValido.desde | fecha: 'corta' }} y el {{ datos.rangoValido.hasta | fecha: 'corta' }}</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Modalidad</mat-label>
          <mat-select formControlName="modalidad">
            <mat-option value="PRESENCIAL">Presencial</mat-option>
            <mat-option value="VIRTUAL">Virtual</mat-option>
            <mat-option value="MIXTA">Mixta</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Tema de la jornada</mat-label>
          <input matInput formControlName="tema" maxlength="200" />
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Observaciones generales</mat-label>
          <textarea matInput formControlName="observaciones" rows="2"></textarea>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Compromisos colectivos</mat-label>
          <textarea matInput formControlName="compromisos" rows="2"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="guardando()">Registrar sesión grupal</button>
    </mat-dialog-actions>
  `,
})
export class GrupalDialogo {
  readonly datos = inject<DatosGrupal>(MAT_DIALOG_DATA);
  private readonly api = inject(ApiService);
  private readonly ref = inject(MatDialogRef<GrupalDialogo>);
  readonly marcados = new Set<number>(this.datos.docentes.map((d) => d.id));
  readonly error = signal('');
  readonly coincidencia = signal(false);
  readonly guardando = signal(false);
  readonly formulario = inject(FormBuilder).nonNullable.group({
    fecha: [this.datos.rangoValido.hasta, Validators.required],
    modalidad: ['PRESENCIAL', Validators.required],
    tema: ['', Validators.required],
    observaciones: ['', Validators.required],
    compromisos: ['', Validators.required],
  });

  alternar(id: number): void {
    if (this.marcados.has(id)) this.marcados.delete(id);
    else this.marcados.add(id);
  }

  guardar(confirmarCoincidencia = false): void {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid) return;
    this.guardando.set(true);
    this.error.set('');
    this.coincidencia.set(false);
    const cuerpo = { ...this.formulario.getRawValue(), anio: this.datos.anio, mes: this.datos.mes, docenteIds: [...this.marcados], confirmarCoincidencia };
    this.api.registrarAcompanamientoGrupal(this.datos.estrategiaId, cuerpo).subscribe({
      next: (r) => this.ref.close(r),
      error: (e) => {
        this.guardando.set(false);
        this.coincidencia.set(errorApi(e)?.codigo === 'SESION_GRUPAL_EXISTENTE');
        this.error.set(mensajeDe(e));
      },
    });
  }
}

/** CU-07 y CU-08: el tutor registra el acompañamiento pedagógico mensual a los docentes de la estrategia. */
@Component({
  selector: 'app-acompanamiento',
  standalone: true,
  imports: [DatePipe, SelectorPeriodoComponent, ChipComponent, MedidorComponent, FechaPipe, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Acompañamiento pedagógico</h1>
        <p class="pagina__sub">Registre el acompañamiento que hizo a cada docente, en sesión individual o en una jornada grupal. Solo aparecen los docentes asociados a la estrategia.</p>
      </div>
      @if (datos(); as d) {
        <div class="pagina__acciones">
          <button mat-stroked-button (click)="grupal()" [disabled]="cerrado() || d.docentes.length < 2"><mat-icon>groups</mat-icon> Registrar sesión grupal</button>
        </div>
      }
    </header>

    <app-selector-periodo preferir="anterior" sinEstrategias="No tiene estrategias asignadas." (seleccion)="elegir($event)" />

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    }

    @if (datos(); as d) {
      @if (d.periodo.estado === 'CERRADO') {
        <div class="aviso aviso--info">
          <mat-icon>lock</mat-icon>
          <div>
            <strong>Periodo cerrado{{ d.periodo.extemporaneo ? ' de forma extemporánea' : '' }}</strong>
            <p>Lo cerró {{ d.periodo.cerradoPor }} el {{ d.periodo.cerradoEn | date: 'd MMM y, h:mm a' }}. Ya no admite registros: si necesita corregirlo, solicite la reapertura desde <em>Seguimiento y cierre</em>.</p>
          </div>
        </div>
      }
      <section class="tarjeta tarjeta--plana">
        <div class="tarjeta__cabecera">
          <div>
            <h2 class="tarjeta__titulo">Docentes de la estrategia · {{ d.periodo.nombre }}</h2>
            <p class="secundario">{{ d.periodo.estado === 'CERRADO' ? 'Periodo cerrado' : 'Periodo abierto' }}{{ d.periodo.corregido ? ' (corregido)' : '' }}. Fechas válidas: {{ d.rangoValido.desde | fecha: 'corta' }} a {{ d.rangoValido.hasta | fecha: 'corta' }}.</p>
          </div>
          <div style="width: 220px">
            <div class="tenue" style="font-size: 12px; margin-bottom: 4px">Docentes acompañados en el mes</div>
            <app-medidor [valor]="d.resumen.acompanados" [total]="d.resumen.asignados" />
          </div>
        </div>
        <table class="tabla">
          <thead><tr><th>Docente</th><th>Acompañamientos del mes</th><th>Último registro</th><th></th></tr></thead>
          <tbody>
            @for (docente of d.docentes; track docente.id) {
              <tr>
                <td><strong>{{ docente.nombre }}</strong><small>{{ docente.area }}</small></td>
                <td>
                  @if (docente.acompanamientos.length) {
                    <app-chip tono="bien" icono="check_circle">{{ docente.acompanamientos.length }} registrado(s)</app-chip>
                  } @else {
                    <app-chip tono="aviso" icono="warning">Sin acompañamiento</app-chip>
                  }
                </td>
                <td>
                  @if (ultimo(docente); as a) {
                    {{ a.fecha | fecha }} · {{ a.tema }}
                    <small>Registrado el {{ a.registradoEn | date: 'd MMM y, h:mm a' }}</small>
                  } @else {
                    <span class="tenue">—</span>
                  }
                </td>
                <td class="derecha">
                  <button mat-stroked-button (click)="registrar(docente)" [disabled]="cerrado()"><mat-icon>add</mat-icon> Registrar</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </section>

      @if (d.sesionesGrupales.length) {
        <section class="tarjeta tarjeta--plana">
          <div class="tarjeta__cabecera"><h2 class="tarjeta__titulo">Sesiones grupales del periodo</h2></div>
          <table class="tabla tabla--compacta">
            <thead><tr><th>Fecha</th><th>Tema</th><th>Asistentes</th><th>Momento del registro</th><th>Oportunidad</th></tr></thead>
            <tbody>
              @for (g of d.sesionesGrupales; track g.id) {
                <tr>
                  <td class="nowrap">{{ g.fecha | fecha }}</td>
                  <td>{{ g.tema }}</td>
                  <td><strong>{{ g.asistentes.length }} docentes</strong><small>{{ g.asistentes.join(', ') }}</small></td>
                  <td class="nowrap">{{ g.registradoEn | date: 'd MMM y, h:mm a' }}</td>
                  <td>
                    @if (g.oportuno) {<app-chip tono="bien" icono="check_circle">A tiempo</app-chip>}
                    @else {<app-chip tono="critico" icono="schedule">{{ g.diasRetraso }} días después</app-chip>}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }

      @if (registros().length) {
        <section class="tarjeta tarjeta--plana">
          <div class="tarjeta__cabecera"><h2 class="tarjeta__titulo">Registros del periodo</h2></div>
          <table class="tabla tabla--compacta">
            <thead><tr><th>Fecha</th><th>Docente</th><th>Tipo</th><th>Tema y compromisos</th><th>Registrado por</th><th>Momento del registro</th><th>Oportunidad</th></tr></thead>
            <tbody>
              @for (a of registros(); track a.id) {
                <tr>
                  <td class="nowrap">{{ a.fecha | fecha }}</td>
                  <td>{{ a.docenteNombre }}</td>
                  <td>{{ a.tipo === 'GRUPAL' ? 'Grupal' : 'Individual' }}</td>
                  <td><strong>{{ a.tema }}</strong><small>{{ a.compromisos }}</small></td>
                  <td>{{ a.registradoPor }}</td>
                  <td class="nowrap">{{ a.registradoEn | date: 'd MMM y, h:mm a' }}</td>
                  <td>
                    @if (a.oportuno) {
                      <app-chip tono="bien" icono="check_circle">A tiempo</app-chip>
                    } @else {
                      <app-chip tono="critico" icono="schedule">{{ a.diasRetraso }} días después</app-chip>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }
    }
  `,
})
export class AcompanamientoComponent {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly datos = signal<DocentesDelPeriodo | null>(null);
  readonly registros = signal<Acompanamiento[]>([]);
  readonly error = signal('');
  private actual: SeleccionDePeriodo | null = null;

  elegir(seleccion: SeleccionDePeriodo): void {
    this.actual = seleccion;
    this.cargar();
  }

  private cargar(): void {
    if (!this.actual) return;
    const { estrategia, periodo } = this.actual;
    this.api.docentesDelPeriodo(estrategia.id, periodo.anio, periodo.mes).subscribe({
      next: (d) => {
        this.datos.set(d);
        this.error.set('');
        this.registros.set(d.docentes.flatMap((x) => x.acompanamientos).sort((a, b) => a.fecha.localeCompare(b.fecha)));
      },
      error: (e) => {
        this.datos.set(null);
        this.error.set(mensajeDe(e));
      },
    });
  }

  ultimo(docente: DocenteDelPeriodo): Acompanamiento | null {
    return docente.acompanamientos.at(-1) ?? null;
  }

  cerrado(): boolean {
    return this.datos()?.periodo.estado === 'CERRADO';
  }

  grupal(): void {
    const d = this.datos();
    if (!d || !this.actual) return;
    const data: DatosGrupal = {
      estrategiaId: this.actual.estrategia.id, anio: d.periodo.anio, mes: d.periodo.mes, periodo: d.periodo.nombre,
      docentes: d.docentes, rangoValido: d.rangoValido,
    };
    this.dialogo.open(GrupalDialogo, { data, width: '680px', disableClose: true }).afterClosed().subscribe((r?: { registros: number; oportuno: boolean; diasRetraso: number }) => {
      if (!r) return;
      this.avisos.open(
        `Sesión grupal registrada: ${r.registros} acompañamientos${r.oportuno ? ' a tiempo' : `, ${r.diasRetraso} días después de realizada`}.`,
        'Cerrar',
      );
      this.cargar();
    });
  }

  registrar(docente: DocenteDelPeriodo): void {
    const d = this.datos();
    if (!d || !this.actual) return;
    const data: DatosDialogo = {
      estrategiaId: this.actual.estrategia.id,
      anio: d.periodo.anio,
      mes: d.periodo.mes,
      periodo: d.periodo.nombre,
      docente,
      rangoValido: d.rangoValido,
    };
    this.dialogo.open(AcompanamientoDialogo, { data, width: '640px', disableClose: true }).afterClosed().subscribe((registro?: Acompanamiento) => {
      if (!registro) return;
      this.avisos.open(
        registro.oportuno
          ? 'Acompañamiento registrado a tiempo.'
          : `Acompañamiento registrado ${registro.diasRetraso} días después de realizado: el tablero lo mostrará como tardío.`,
        'Cerrar',
      );
      this.cargar();
    });
  }
}
