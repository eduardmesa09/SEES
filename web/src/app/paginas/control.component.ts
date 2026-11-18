import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../core/api.service';
import {
  ChipComponent, ConfirmarDialogo, DatosConfirmacion, MATERIAL, MedidorComponent, PATRON, guardarArchivo, mensajeDe, mesesRecientes,
} from '../core/compartido';
import { Entidad, FilaTablero, ReporteDeControl } from '../core/modelos';
import { ConsolidadoComponent } from './consolidado.component';
import { DetalleTableroDialogo } from './tablero.component';

/**
 * CU-13 / RQ_013: el ente de control genera por sí mismo los reportes, sin pedir un archivo al Ministerio.
 * Distingue lo certificado de lo preliminar, permite descender hasta el registro individual y
 * cada consulta y descarga queda registrada con el usuario, la fecha y los filtros.
 */
@Component({
  selector: 'app-control',
  standalone: true,
  imports: [FormsModule, DatePipe, ChipComponent, MedidorComponent, ConsolidadoComponent, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Reportes de control</h1>
        <p class="pagina__sub">Información consolidada del programa con su fecha de corte y su estado de certificación.</p>
      </div>
      @if (reporte()) {
        <div class="pagina__acciones">
          <button mat-flat-button color="primary" (click)="descargar()"><mat-icon>download</mat-icon> Descargar reporte</button>
        </div>
      }
    </header>

    <div class="filtros">
      <mat-form-field>
        <mat-label>Periodo</mat-label>
        <mat-select [(ngModel)]="periodo" (ngModelChange)="cargar()">
          @for (p of periodos; track p.clave) {<mat-option [value]="p.clave">{{ p.nombre }}{{ p.enCurso ? ' (en curso)' : '' }}</mat-option>}
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Territorio</mat-label>
        <mat-select [(ngModel)]="territorio" (ngModelChange)="entidadId = 0; cargar()">
          <mat-option value="">Todos</mat-option>
          @for (t of territorios(); track t) {<mat-option [value]="t">{{ t }}</mat-option>}
        </mat-select>
      </mat-form-field>
      <mat-form-field class="filtros__amplio">
        <mat-label>Entidad</mat-label>
        <mat-select [(ngModel)]="entidadId" (ngModelChange)="cargar()">
          <mat-option [value]="0">Todas</mat-option>
          @for (e of entidadesFiltradas(); track e.id) {<mat-option [value]="e.id">{{ e.nombre }}</mat-option>}
        </mat-select>
      </mat-form-field>
      <mat-form-field style="width: 200px">
        <mat-label>Verificar código</mat-label>
        <input matInput [(ngModel)]="codigo" placeholder="SSES-…" (keyup.enter)="verificar()" />
        <mat-icon matSuffix style="cursor: pointer" (click)="verificar()">verified</mat-icon>
      </mat-form-field>
    </div>

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    }

    @if (reporte(); as r) {
      @if (r.certificacion.estado === 'CERTIFICADO') {
        <div class="aviso aviso--bien">
          <mat-icon>verified</mat-icon>
          <div>
            <strong>Certificado · versión {{ r.certificacion.version }} · <span class="codigo">{{ r.certificacion.codigoVerificacion }}</span></strong>
            <p>
              Certificado por {{ r.certificacion.certificadoPor }} el {{ r.certificacion.certificadoEn | date: 'd MMM y, h:mm a' }}.
              Las cifras de la parte superior son las certificadas y pueden usarse en un informe oficial.
              @if (r.certificacion.motivoAjuste) { Ajuste: {{ r.certificacion.motivoAjuste }}. }
            </p>
            @if (r.certificacion.anteriores.length) {
              <p style="margin-top: 6px">
                <strong style="display: inline">Existe una versión anterior consultable:</strong>
                @for (v of r.certificacion.anteriores; track v.id) {
                  v{{ v.version }} del {{ v.certificadoEn | date: 'd MMM y' }} (<span class="codigo">{{ v.codigoVerificacion }}</span>){{ $last ? '.' : ',' }}
                }
              </p>
            }
            @if (r.certificacion.exclusiones.length) {
              <p style="margin-top: 6px">Excluido del reporte: @for (x of r.certificacion.exclusiones; track x.estrategiaId) { {{ x.nombre }} ({{ x.motivo }}){{ $last ? '.' : '; ' }} }</p>
            }
          </div>
        </div>
        @if (entidadId) {
          <p class="secundario" style="margin: -6px 0 14px">La certificación cubre todo el alcance. Abajo, las cifras de la entidad seleccionada.</p>
          <app-consolidado [cifras]="r.cifras" [cobertura]="r.coberturaInformacion" [grupos]="r.porEntidad" tituloGrupos="Entidad" columnaGrupo="Entidad" />
        } @else {
          <app-consolidado [cifras]="r.certificacion.cifras" [cobertura]="r.certificacion.coberturaInformacion" [grupos]="r.porTerritorio" />
        }
      } @else {
        <div class="aviso aviso--aviso">
          <mat-icon>warning</mat-icon>
          <div>
            <strong>Información preliminar, no oficial</strong>
            <p>
              El periodo no ha sido certificado. La cobertura de información es del {{ r.coberturaInformacion.porcentaje }} %
              ({{ r.coberturaInformacion.estrategiasCerradas }} de {{ r.coberturaInformacion.estrategiasDelAlcance }} estrategias con periodo cerrado).
              Esta advertencia también va en el archivo descargado.
            </p>
          </div>
        </div>
        <app-consolidado [cifras]="r.cifras" [cobertura]="r.coberturaInformacion" [grupos]="r.porTerritorio" />
      }

      <p class="tenue" style="font-size: 12.5px; margin: 10px 0 0">Fecha de corte: {{ r.fechaCorte | date: 'd MMM y, h:mm:ss a' }}. Detalle por estrategia con los datos vigentes al corte.</p>

      <section class="tarjeta tarjeta--plana" style="margin-top: 18px">
        <div class="tarjeta__cabecera">
          <div><h2 class="tarjeta__titulo">Por estrategia</h2><p class="secundario">Clic en una fila para ver la trazabilidad de cada registro: quién lo hizo y en qué fecha.</p></div>
        </div>
        @if (!r.estrategias.length) {
          <div class="vacio"><mat-icon>search_off</mat-icon><strong>No hay información para estos filtros</strong>La selección se conserva: ajuste el periodo, el territorio o la entidad.</div>
        } @else {
          <table class="tabla tabla--clic">
            <thead><tr><th>Estrategia</th><th>Tutor</th><th class="centro">Estudiantes</th><th>Docentes acompañados</th><th>Semanas con seguimiento</th><th>Patrón del registro</th><th>Periodo</th></tr></thead>
            <tbody>
              @for (e of r.estrategias; track e.id) {
                <tr (click)="detalle(e)">
                  <td><strong>{{ e.nombre }}</strong><small>{{ e.codigo }} · {{ e.entidadNombre }} ({{ e.territorio }})</small></td>
                  <td>@for (t of e.tutores; track t.id) {<div>{{ t.nombre }}</div>}</td>
                  <td class="centro mono">{{ e.vinculados }}</td>
                  <td><app-medidor [valor]="e.docentesAcompanados" [total]="e.docentesAsignados" /></td>
                  <td><app-medidor [valor]="e.semanasReportadas" [total]="e.semanasExigibles" /></td>
                  <td><app-chip [tono]="patron[e.patron].tono" [icono]="patron[e.patron].icono">{{ patron[e.patron].etiqueta }}</app-chip></td>
                  <td>
                    @if (e.periodo.estado === 'CERRADO') {<app-chip [tono]="e.periodo.extemporaneo ? 'aviso' : 'bien'" icono="lock">{{ e.periodo.extemporaneo ? 'Cerrado tarde' : 'Cerrado' }}</app-chip>}
                    @else {<app-chip tono="neutro" icono="lock_open">Abierto</app-chip>}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (r.tutores.length) {
        <section class="tarjeta tarjeta--plana">
          <div class="tarjeta__cabecera"><h2 class="tarjeta__titulo">Por tutor</h2></div>
          <table class="tabla tabla--compacta">
            <thead><tr><th>Tutor</th><th class="centro">Estrategias</th><th class="centro">Acompañamientos registrados</th><th>Semanas con seguimiento</th><th>Registro oportuno</th><th>Patrón</th><th>Cierres</th></tr></thead>
            <tbody>
              @for (t of r.tutores; track t.id) {
                <tr>
                  <td><strong>{{ t.nombre }}</strong></td>
                  <td class="centro mono">{{ t.estrategias }}</td>
                  <td class="centro mono">{{ t.acompanamientos }}</td>
                  <td><app-medidor [valor]="t.semanasReportadas" [total]="t.semanasExigibles" /></td>
                  <td class="mono">{{ t.oportunidadPct }} %</td>
                  <td><app-chip [tono]="patron[t.patron].tono" [icono]="patron[t.patron].icono">{{ patron[t.patron].etiqueta }}</app-chip></td>
                  <td class="nowrap">{{ t.periodosCerrados }} de {{ t.estrategias }}@if (t.cierresExtemporaneos) {<small class="tono--aviso">{{ t.cierresExtemporaneos }} fuera de plazo</small>}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }
    } @else if (!error()) {
      <div class="cargando">Generando reporte…</div>
    }
  `,
})
export class ControlComponent {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly patron = PATRON;
  readonly reporte = signal<ReporteDeControl | null>(null);
  readonly territorios = signal<string[]>([]);
  readonly entidades = signal<Entidad[]>([]);
  readonly error = signal('');

  periodos: ReturnType<typeof mesesRecientes> = [];
  periodo = '';
  territorio = '';
  entidadId = 0;
  codigo = '';

  constructor() {
    this.api.territorios().subscribe((t) => this.territorios.set(t));
    this.api.entidades().subscribe((e) => this.entidades.set(e));
    this.api.listas().subscribe((listas) => {
      this.periodos = mesesRecientes(listas.hoy);
      this.periodo = this.periodos[1].clave;
      this.cargar();
    });
  }

  entidadesFiltradas(): Entidad[] {
    return this.entidades().filter((e) => !this.territorio || e.territorio === this.territorio);
  }

  private filtros() {
    const [anio, mes] = this.periodo.split('-').map(Number);
    return { anio, mes, territorio: this.territorio, entidadId: this.entidadId || null };
  }

  cargar(): void {
    this.api.reporteDeControl(this.filtros()).subscribe({
      next: (r) => { this.reporte.set(r); this.error.set(''); },
      error: (e) => this.error.set(mensajeDe(e)),
    });
  }

  detalle(fila: FilaTablero): void {
    const { anio, mes } = this.filtros();
    this.api.detalleTablero(fila.id, anio, mes).subscribe({
      next: (d) => this.dialogo.open(DetalleTableroDialogo, { data: d, width: '920px', maxWidth: '95vw' }),
      error: (e) => this.error.set(mensajeDe(e)),
    });
  }

  descargar(): void {
    this.api.descargaReporteDeControl(this.filtros()).subscribe({
      next: (archivo) => guardarArchivo(archivo, `reporte-control-${this.periodo}.csv`),
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }

  verificar(): void {
    if (!this.codigo.trim()) return;
    this.api.verificar(this.codigo).subscribe({
      next: (c) => {
        const datos: DatosConfirmacion = {
          titulo: 'Código auténtico',
          mensaje: `Corresponde al reporte de ${c.periodo} (${c.alcance === 'TODOS' ? 'todo el territorio del certificador' : c.alcance}), versión ${c.version}, certificado por ${c.certificadoPor}.`,
          detalles: [c.vigente ? 'Es la versión vigente.' : 'Existe una versión posterior: esta ya no es la vigente.'],
          aceptar: 'Entendido', cancelar: null, icono: 'verified', tono: 'bien',
        };
        this.dialogo.open(ConfirmarDialogo, { data: datos, width: '520px' });
      },
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }
}
