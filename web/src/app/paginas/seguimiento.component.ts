import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../core/api.service';
import {
  ChipComponent, ConfirmarDialogo, DatosConfirmacion, DatosTexto, ESTADO_SEMANA, FechaPipe, MATERIAL, MedidorComponent, RespuestaTexto,
  TextoDialogo, errorApi, mensajeDe,
} from '../core/compartido';
import { Cobertura, ResumenCierre, Semana, SemanasDelPeriodo } from '../core/modelos';
import { SeleccionDePeriodo, SelectorPeriodoComponent } from '../core/selector-periodo';

interface DatosDialogo {
  estrategiaId: number;
  anio: number;
  mes: number;
  semana: Semana;
  causas: string[];
}

/** CU-09: formulario del seguimiento de una semana. */
@Component({
  selector: 'app-seguimiento-dialogo',
  standalone: true,
  imports: [ReactiveFormsModule, FechaPipe, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>Semana {{ datos.semana.semanaIso }} · {{ datos.semana.inicio | fecha: 'corta' }} a {{ datos.semana.fin | fecha: 'corta' }}</h2>
    <mat-dialog-content>
      @if (datos.semana.seguimiento) {
        <p class="dialogo__mensaje">Esta semana ya tiene seguimiento: se edita el existente y se conserva la versión anterior.</p>
      }
      @if (error()) {
        <div class="aviso aviso--critico dialogo__error" style="margin-top: 12px"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
      }

      <form [formGroup]="formulario" style="margin-top: 12px">
        <mat-slide-toggle formControlName="sinActividad">No hubo actividad esta semana</mat-slide-toggle>

        <div class="formulario" style="margin-top: 16px">
          @if (formulario.controls.sinActividad.value) {
            <mat-form-field class="ancho">
              <mat-label>Causa por la cual no hubo actividad</mat-label>
              <mat-select formControlName="causaInactividad">
                @for (c of datos.causas; track c) {<mat-option [value]="c">{{ c }}</mat-option>}
              </mat-select>
              <mat-hint>La semana queda explicada, no simplemente vacía.</mat-hint>
              <mat-error>{{ errorDe('causaInactividad') }}</mat-error>
            </mat-form-field>
          } @else {
            <mat-form-field class="ancho">
              <mat-label>Actividades realizadas</mat-label>
              <textarea matInput formControlName="actividades" rows="3"></textarea>
              <mat-error>{{ errorDe('actividades') }}</mat-error>
            </mat-form-field>
            <mat-form-field class="ancho">
              <mat-label>Avance frente a los compromisos con los docentes</mat-label>
              <textarea matInput formControlName="avanceCompromisos" rows="2"></textarea>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Dificultades presentadas</mat-label>
              <textarea matInput formControlName="dificultades" rows="2"></textarea>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Acciones tomadas o previstas</mat-label>
              <textarea matInput formControlName="acciones" rows="2"></textarea>
            </mat-form-field>
          }
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="guardando()">Guardar seguimiento</button>
    </mat-dialog-actions>
  `,
})
export class SeguimientoDialogo {
  readonly datos = inject<DatosDialogo>(MAT_DIALOG_DATA);
  private readonly api = inject(ApiService);
  private readonly ref = inject(MatDialogRef<SeguimientoDialogo>);
  readonly error = signal('');
  readonly guardando = signal(false);

  private readonly previo = this.datos.semana.seguimiento;
  readonly formulario = inject(FormBuilder).nonNullable.group({
    sinActividad: [this.previo?.sinActividad ?? false],
    causaInactividad: [this.previo?.causaInactividad ?? ''],
    actividades: [this.previo?.actividades ?? ''],
    avanceCompromisos: [this.previo?.avanceCompromisos ?? ''],
    dificultades: [this.previo?.dificultades ?? ''],
    acciones: [this.previo?.acciones ?? ''],
  });

  errorDe(campo: string): string {
    return (this.formulario.get(campo)?.errors?.['servidor'] as string) ?? '';
  }

  guardar(): void {
    this.guardando.set(true);
    this.error.set('');
    const { semana, estrategiaId, anio, mes } = this.datos;
    const cuerpo = { ...this.formulario.getRawValue(), anio, mes };
    this.api.registrarSeguimiento(estrategiaId, semana.anioIso, semana.semanaIso, cuerpo).subscribe({
      next: (respuesta) => this.ref.close(respuesta),
      error: (e) => {
        this.guardando.set(false);
        const campos = errorApi(e)?.campos ?? {};
        for (const [campo, mensaje] of Object.entries(campos)) {
          const control = this.formulario.get(campo);
          control?.setErrors({ servidor: mensaje });
          control?.markAsTouched();
        }
        this.error.set(mensajeDe(e));
      },
    });
  }
}

/** CU-09 y CU-10: seguimiento semanal del acompañamiento, cobertura del mes y cierre del periodo. */
@Component({
  selector: 'app-seguimiento',
  standalone: true,
  imports: [DatePipe, SelectorPeriodoComponent, ChipComponent, MedidorComponent, FechaPipe, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Seguimiento semanal y cierre</h1>
        <p class="pagina__sub">El acompañamiento se planea por mes, pero ocurre semana a semana. Reporte cada semana a medida que transcurre.</p>
      </div>
    </header>

    <app-selector-periodo sinEstrategias="Cree una estrategia o pida que le asignen una." (seleccion)="elegir($event)" />

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    }

    @if (datos(); as d) {
      <section class="tarjeta">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap">
          <div>
            <h2 class="tarjeta__titulo">Cobertura de {{ d.periodo.nombre }}</h2>
            <p class="secundario">
              {{ d.cobertura.reportadas }} de las {{ d.cobertura.esperadas }} semanas del periodo tienen seguimiento.
              @if (d.pendientes) { <strong>{{ d.pendientes }} semana(s) ya terminaron sin reporte.</strong> }
            </p>
          </div>
          <div style="width: 280px"><app-medidor [valor]="d.cobertura.reportadas" [total]="d.cobertura.esperadas" /></div>
        </div>
      </section>

      <div class="semanas" style="margin-top: 18px">
        @for (s of d.semanas; track s.inicio) {
          <article class="semana semana--{{ s.estado }}">
            <div>
              <div class="semana__titulo">Semana {{ s.semanaIso }}</div>
              <div class="semana__rango">{{ s.inicio | fecha: 'corta' }} a {{ s.fin | fecha }}</div>
            </div>
            <div><app-chip [tono]="estado[s.estado].tono" [icono]="estado[s.estado].icono">{{ estado[s.estado].etiqueta }}</app-chip></div>
            <div class="semana__detalle">
              @if (s.seguimiento; as seg) {
                @if (seg.sinActividad) { Causa: {{ seg.causaInactividad }}. } @else { {{ seg.actividades }} }
                <div class="tenue" style="margin-top: 4px">{{ seg.registradoPor }} · {{ seg.registradoEn | date: 'd MMM y, h:mm a' }}</div>
              } @else if (s.estado === 'FUTURA') {
                Podrá reportarse desde el {{ s.inicio | fecha: 'corta' }}.
              } @else if (s.estado === 'EN_CURSO') {
                Semana en curso: puede reportarse a tiempo hasta tres días después del domingo.
              } @else {
                La semana terminó y no tiene reporte. Si no hubo actividad, regístrela con su causa.
              }
            </div>
            <div class="semana__pie">
              @if (s.seguimiento; as seg) {
                @if (seg.oportuno) {
                  <app-chip tono="bien" icono="check_circle">A tiempo</app-chip>
                } @else {
                  <app-chip tono="critico" icono="schedule">{{ seg.diasRetraso }} días después</app-chip>
                }
                @if (d.periodo.estado === 'ABIERTO') {<button mat-button (click)="reportar(s)"><mat-icon>edit</mat-icon> Editar</button>}
              } @else {
                <span></span>
                <span [matTooltip]="s.estado === 'FUTURA' ? 'No puede reportarse lo que todavía no ha ocurrido' : d.periodo.estado === 'CERRADO' ? 'El periodo está cerrado' : ''">
                  <button mat-flat-button color="primary" (click)="reportar(s)" [disabled]="s.estado === 'FUTURA' || d.periodo.estado === 'CERRADO'">Reportar</button>
                </span>
              }
            </div>
          </article>
        }
      </div>

      <section class="tarjeta" style="margin-top: 18px">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap">
          <div>
            <h2 class="tarjeta__titulo">Cierre del periodo · {{ d.periodo.nombre }}</h2>
            @if (d.periodo.estado === 'CERRADO') {
              <p class="secundario">
                Cerrado por {{ d.periodo.cerradoPor }} el {{ d.periodo.cerradoEn | date: 'd MMM y, h:mm a' }}.
                La información quedó disponible para los reportes del Ministerio y ya no puede modificarse.
              </p>
            } @else {
              <p class="secundario">Cerrar el periodo deja la información lista para los reportes de ley y bloquea su modificación.</p>
            }
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            @if (d.periodo.estado === 'CERRADO') {
              @if (d.periodo.extemporaneo) {<app-chip tono="aviso" icono="schedule">Cierre extemporáneo</app-chip>}
              @else {<app-chip tono="bien" icono="lock">Cerrado a tiempo</app-chip>}
              @if (d.periodo.reaperturaPendiente) {
                <app-chip tono="info" icono="hourglass_top">Reapertura en trámite</app-chip>
              } @else {
                <button mat-stroked-button (click)="solicitarReapertura()"><mat-icon>lock_open</mat-icon> Solicitar reapertura</button>
              }
            } @else {
              @if (d.periodo.corregido) {<app-chip tono="info" icono="history">Reabierto para corrección</app-chip>}
              <span [matTooltip]="cierre()?.mesTerminado ? '' : 'El mes aún no ha terminado'">
                <button mat-flat-button color="primary" (click)="cerrar()" [disabled]="!cierre()?.mesTerminado"><mat-icon>task_alt</mat-icon> Cerrar periodo</button>
              </span>
            }
          </div>
        </div>
        @if (d.periodo.estado === 'CERRADO' && d.periodo.justificacionCierre) {
          <div class="cita" style="margin: 14px 0 0"><small>Justificación del cierre</small>{{ d.periodo.justificacionCierre }}</div>
        }
        @if (d.periodo.estado === 'ABIERTO' && cierre(); as c) {
          <div class="resumen-cierre">
            <div><span>Docentes acompañados</span><strong>{{ c.resumen.docentesAcompanados }} de {{ c.resumen.docentesAsignados }}</strong></div>
            <div><span>Acompañamientos individuales</span><strong>{{ c.resumen.acompanamientosIndividuales }}</strong></div>
            <div><span>Sesiones grupales</span><strong>{{ c.resumen.sesionesGrupales }}</strong></div>
            <div><span>Semanas con seguimiento</span><strong>{{ c.resumen.semanasReportadas }} de {{ c.resumen.semanasEsperadas }}</strong></div>
          </div>
          @if (!c.resumen.completo) {
            <div class="aviso aviso--aviso" style="margin: 14px 0 0">
              <mat-icon>warning</mat-icon>
              <div>
                <strong>Hay información sin cubrir: el cierre exigirá justificación</strong>
                @if (c.resumen.semanasPendientes.length) {<p>Semanas sin reporte: {{ semanasPendientes(c) }}.</p>}
                @if (c.resumen.docentesSinAcompanamiento.length) {<p>Docentes sin acompañamiento: {{ c.resumen.docentesSinAcompanamiento.join(', ') }}.</p>}
              </div>
            </div>
          }
          <p class="tenue" style="font-size: 12.5px; margin-top: 10px">
            Plazo para cerrar a tiempo: hasta el {{ c.plazo | fecha }}.
            @if (c.extemporaneo) { <strong class="tono--aviso">El plazo ya venció: el cierre quedará marcado como extemporáneo.</strong> }
          </p>
        }
      </section>
    }
  `,
})
export class SeguimientoComponent {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly estado = ESTADO_SEMANA;
  readonly datos = signal<SemanasDelPeriodo | null>(null);
  readonly cierre = signal<ResumenCierre | null>(null);
  readonly error = signal('');
  private actual: SeleccionDePeriodo | null = null;
  private causas: string[] = [];

  constructor() {
    this.api.listas().subscribe((listas) => (this.causas = listas.causasInactividad));
  }

  elegir(seleccion: SeleccionDePeriodo): void {
    this.actual = seleccion;
    this.cargar();
  }

  private cargar(): void {
    if (!this.actual) return;
    const { estrategia, periodo } = this.actual;
    this.api.semanas(estrategia.id, periodo.anio, periodo.mes).subscribe({
      next: (d) => {
        this.datos.set(d);
        this.error.set('');
        this.cargarCierre();
      },
      error: (e) => {
        this.datos.set(null);
        this.error.set(mensajeDe(e));
      },
    });
  }

  reportar(semana: Semana): void {
    const d = this.datos();
    if (!d || !this.actual) return;
    const data: DatosDialogo = { estrategiaId: this.actual.estrategia.id, anio: d.periodo.anio, mes: d.periodo.mes, semana, causas: this.causas };
    this.dialogo.open(SeguimientoDialogo, { data, width: '640px', disableClose: true }).afterClosed()
      .subscribe((respuesta?: { creado: boolean; cobertura: Cobertura }) => {
        if (!respuesta) return;
        this.avisos.open(
          `${respuesta.creado ? 'Seguimiento registrado' : 'Seguimiento actualizado'}. Cobertura del mes: ${respuesta.cobertura.reportadas} de ${respuesta.cobertura.esperadas} semanas (${respuesta.cobertura.porcentaje} %).`,
          'Cerrar',
        );
        this.cargar();
      });
  }

  semanasPendientes(c: ResumenCierre): string {
    return c.resumen.semanasPendientes.map((p) => `semana ${p.semanaIso}`).join(', ');
  }

  private cargarCierre(): void {
    if (!this.actual) return;
    const { estrategia, periodo } = this.actual;
    this.api.resumenCierre(estrategia.id, periodo.anio, periodo.mes).subscribe({ next: (c) => this.cierre.set(c), error: () => this.cierre.set(null) });
  }

  /** CU-10: con todo cubierto basta confirmar; si falta algo, el cierre exige justificación. */
  cerrar(): void {
    const c = this.cierre();
    if (!c || !this.actual) return;
    const { estrategia, periodo } = this.actual;
    const enviar = (justificacion?: string) =>
      this.api.cerrarPeriodo(estrategia.id, periodo.anio, periodo.mes, justificacion).subscribe({
        next: (r) => {
          this.avisos.open(r.extemporaneo ? 'Periodo cerrado fuera del plazo: queda marcado como extemporáneo.' : 'Periodo cerrado a tiempo.', 'Cerrar');
          this.cargar();
        },
        error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
      });

    const resumen = [
      `${c.resumen.docentesAcompanados} de ${c.resumen.docentesAsignados} docentes acompañados`,
      `${c.resumen.acompanamientosIndividuales} acompañamientos individuales y ${c.resumen.sesionesGrupales} sesiones grupales`,
      `${c.resumen.semanasReportadas} de ${c.resumen.semanasEsperadas} semanas con seguimiento`,
    ];
    if (c.resumen.completo) {
      const datos: DatosConfirmacion = {
        titulo: `Cerrar ${c.periodo.nombre}`,
        mensaje: 'Después del cierre la información no podrá modificarse sin una reapertura aprobada por el tutor líder.',
        detalles: resumen, aceptar: 'Cerrar periodo', icono: 'task_alt', tono: 'info',
      };
      this.dialogo.open(ConfirmarDialogo, { data: datos, width: '520px' }).afterClosed().subscribe((ok) => ok && enviar());
      return;
    }
    const faltantes = [
      ...c.resumen.semanasPendientes.map((p) => `Semana ${p.semanaIso} sin reporte`),
      ...c.resumen.docentesSinAcompanamiento.map((n) => `${n} sin acompañamiento`),
    ];
    const datos: DatosTexto = {
      titulo: `Cerrar ${c.periodo.nombre} con justificación`,
      mensaje: 'El periodo tiene información sin cubrir. Puede cerrarlo, pero la justificación quedará asociada al cierre y será visible para quien lo revise.',
      detalles: faltantes, etiqueta: 'Justificación', minimo: 10, aceptar: 'Cerrar con justificación',
    };
    this.dialogo.open(TextoDialogo, { data: datos, width: '560px' }).afterClosed().subscribe((r?: RespuestaTexto) => r && enviar(r.texto));
  }

  solicitarReapertura(): void {
    const d = this.datos();
    if (!d || !this.actual) return;
    const { estrategia, periodo } = this.actual;
    const datos: DatosTexto = {
      titulo: `Solicitar la reapertura de ${d.periodo.nombre}`,
      mensaje: 'La solicitud la decide el tutor líder. Mientras tanto el periodo sigue cerrado. Si se aprueba, la versión cerrada se conserva y el periodo queda marcado como corregido.',
      etiqueta: 'Motivo de la reapertura', minimo: 10, aceptar: 'Radicar solicitud',
    };
    this.dialogo.open(TextoDialogo, { data: datos, width: '560px' }).afterClosed().subscribe((r?: RespuestaTexto) => {
      if (!r) return;
      this.api.solicitarReapertura(estrategia.id, periodo.anio, periodo.mes, r.texto).subscribe({
        next: () => {
          this.avisos.open('Solicitud de reapertura radicada ante el tutor líder.', 'Cerrar');
          this.cargar();
        },
        error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
      });
    });
  }
}
