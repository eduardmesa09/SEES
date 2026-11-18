import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../core/api.service';
import {
  ChipComponent, DatosTexto, DistribucionComponent, ESTADO_SEMANA, FechaPipe, MATERIAL, MedidorComponent, PATRON, RespuestaTexto,
  TextoDialogo, guardarArchivo, mensajeDe,
} from '../core/compartido';
import { DetalleTablero, Entidad, FilaTablero, Persona, Tablero, TutorTablero } from '../core/modelos';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Descenso al detalle: los registros individuales que explican cada cifra, con su autor y su fecha. */
@Component({
  selector: 'app-detalle-tablero',
  standalone: true,
  imports: [DatePipe, ChipComponent, FechaPipe, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>{{ d.estrategia.nombre }} · {{ d.periodo.nombre }}</h2>
    <mat-dialog-content>
      <p class="dialogo__mensaje">{{ d.estrategia.codigo }} · {{ d.estrategia.entidadNombre }} ({{ d.estrategia.territorio }})</p>
      @if (d.periodo.estado === 'CERRADO') {
        <div class="aviso aviso--bien" style="margin: 12px 0 0">
          <mat-icon>lock</mat-icon>
          <div>
            <strong>Periodo cerrado{{ d.periodo.extemporaneo ? ' de forma extemporánea' : '' }}{{ d.periodo.corregido ? ' tras una corrección' : '' }}</strong>
            <p>Por {{ d.periodo.cerradoPor }} el {{ d.periodo.cerradoEn | date: 'd MMM y, h:mm a' }}.{{ d.periodo.justificacionCierre ? ' Justificación: ' + d.periodo.justificacionCierre : '' }}</p>
          </div>
        </div>
      } @else {
        <div class="aviso aviso--aviso" style="margin: 12px 0 0">
          <mat-icon>info</mat-icon>
          <div><strong>Periodo abierto</strong><p>Las cifras son preliminares: el tutor aún puede registrar y corregir.</p></div>
        </div>
      }

      <h3 class="tarjeta__titulo" style="margin: 18px 0 8px">Seguimiento semanal · {{ d.cobertura.reportadas }} de {{ d.cobertura.esperadas }} semanas</h3>
      <table class="tabla tabla--compacta">
        <thead><tr><th>Semana</th><th>Estado</th><th>Registrado por</th><th>Momento del registro</th><th>Oportunidad</th></tr></thead>
        <tbody>
          @for (s of d.semanas; track s.inicio) {
            <tr>
              <td class="nowrap"><strong>Semana {{ s.semanaIso }}</strong><small>{{ s.inicio | fecha: 'corta' }} a {{ s.fin | fecha: 'corta' }}</small></td>
              <td><app-chip [tono]="estado[s.estado].tono" [icono]="estado[s.estado].icono">{{ estado[s.estado].etiqueta }}</app-chip></td>
              @if (s.seguimiento; as seg) {
                <td>{{ seg.registradoPor }}</td>
                <td class="nowrap">{{ seg.registradoEn | date: 'd MMM y, h:mm a' }}</td>
                <td>
                  @if (seg.oportuno) {<app-chip tono="bien" icono="check_circle">A tiempo</app-chip>}
                  @else {<app-chip tono="critico" icono="schedule">{{ seg.diasRetraso }} días después</app-chip>}
                </td>
              } @else {
                <td class="tenue">—</td><td class="tenue">—</td><td class="tenue">—</td>
              }
            </tr>
          }
        </tbody>
      </table>

      <h3 class="tarjeta__titulo" style="margin: 22px 0 8px">Acompañamientos del mes · {{ d.acompanamientos.length }}</h3>
      @if (d.acompanamientos.length) {
        <table class="tabla tabla--compacta">
          <thead><tr><th>Realizado el</th><th>Docente</th><th>Tipo</th><th>Tema</th><th>Registrado por</th><th>Momento del registro</th><th>Oportunidad</th></tr></thead>
          <tbody>
            @for (a of d.acompanamientos; track a.id) {
              <tr>
                <td class="nowrap">{{ a.fecha | fecha }}</td>
                <td>{{ a.docenteNombre }}</td>
                <td>{{ a.tipo === 'GRUPAL' ? 'Grupal' : 'Individual' }}</td>
                <td>{{ a.tema }}</td>
                <td>{{ a.registradoPor }}</td>
                <td class="nowrap">{{ a.registradoEn | date: 'd MMM y, h:mm a' }}</td>
                <td>
                  @if (a.oportuno) {<app-chip tono="bien" icono="check_circle">A tiempo</app-chip>}
                  @else {<app-chip tono="critico" icono="schedule">{{ a.diasRetraso }} días después</app-chip>}
                </td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p class="tenue">No hay acompañamientos registrados en el periodo.</p>
      }

      @if (d.docentesSinAcompanamiento.length) {
        <div class="aviso aviso--aviso" style="margin: 16px 0 0">
          <mat-icon>warning</mat-icon>
          <div><strong>Docentes sin acompañamiento en el mes</strong><p>{{ sinAcompanamiento }}</p></div>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-flat-button color="primary" mat-dialog-close>Cerrar</button></mat-dialog-actions>
  `,
})
export class DetalleTableroDialogo {
  readonly d = inject<DetalleTablero>(MAT_DIALOG_DATA);
  readonly estado = ESTADO_SEMANA;
  readonly sinAcompanamiento = this.d.docentesSinAcompanamiento.map((x) => x.nombre).join(', ');
}

/** CU-11: cumplimiento y desempeño a partir de lo que quedó registrado, y de cuándo quedó registrado. */
@Component({
  selector: 'app-tablero',
  standalone: true,
  imports: [FormsModule, ChipComponent, MedidorComponent, DistribucionComponent, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Tablero de cumplimiento y desempeño</h1>
        <p class="pagina__sub">Evalúa el trabajo y no el reporte: qué se registró, cuánto cubre y en qué momento del mes se registró.</p>
      </div>
      @if (tablero()) {
        <div class="pagina__acciones">
          <button mat-stroked-button (click)="exportar()"><mat-icon>download</mat-icon> Exportar consolidado</button>
        </div>
      }
    </header>

    <div class="filtros">
      <mat-form-field>
        <mat-label>Periodo mensual</mat-label>
        <mat-select [(ngModel)]="periodo" (ngModelChange)="cargar()">
          @for (p of periodos; track p.clave) {<mat-option [value]="p.clave">{{ p.nombre }}</mat-option>}
        </mat-select>
      </mat-form-field>
      <mat-form-field class="filtros__amplio">
        <mat-label>Entidad</mat-label>
        <mat-select [(ngModel)]="entidadId" (ngModelChange)="cargar()">
          <mat-option [value]="null">Todas las de mi territorio</mat-option>
          @for (e of entidades(); track e.id) {<mat-option [value]="e.id">{{ e.nombre }}</mat-option>}
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Tutor</mat-label>
        <mat-select [(ngModel)]="tutorId" (ngModelChange)="cargar()">
          <mat-option [value]="null">Todos</mat-option>
          @for (t of tutores(); track t.id) {<mat-option [value]="t.id">{{ t.nombre }}</mat-option>}
        </mat-select>
      </mat-form-field>
    </div>

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    }

    @if (tablero(); as t) {
      @if (t.periodo.preliminar) {
        <div class="aviso aviso--aviso">
          <mat-icon>info</mat-icon>
          <div>
            <strong>Información preliminar · {{ t.periodo.nombre }}{{ t.periodo.enCurso ? ' (mes en curso)' : '' }}</strong>
            <p>{{ t.periodo.periodosAbiertos }} de {{ t.resumen.estrategias }} periodo(s) siguen abiertos y sus cifras aún pueden cambiar. No debe usarse para un reporte oficial.</p>
          </div>
        </div>
      } @else {
        <div class="aviso aviso--bien">
          <mat-icon>lock</mat-icon>
          <div><strong>Cifras definitivas · {{ t.periodo.nombre }}</strong><p>{{ t.periodo.advertencia }}</p></div>
        </div>
      }

      <div class="indicadores">
        <div class="indicador">
          <div class="indicador__etiqueta">Estrategias en el periodo</div>
          <div class="indicador__valor">{{ t.resumen.estrategias }}</div>
          <div class="indicador__nota">{{ t.resumen.estudiantesVinculados }} estudiantes vinculados</div>
        </div>
        <div class="indicador">
          <div class="indicador__etiqueta">Docentes acompañados</div>
          <div class="indicador__valor">{{ t.resumen.docentesAcompanados }} <small>de {{ t.resumen.docentesAsignados }}</small></div>
          <div class="indicador__nota">{{ t.resumen.acompanamientosIndividuales }} individuales · {{ t.resumen.sesionesGrupales }} sesiones grupales</div>
        </div>
        <div class="indicador">
          <div class="indicador__etiqueta">Semanas con seguimiento</div>
          <div class="indicador__valor">{{ t.resumen.semanasReportadas }} <small>de {{ t.resumen.semanasExigibles }}</small></div>
          <div class="indicador__nota">{{ t.resumen.coberturaSemanalPct }} % de las semanas ya exigibles</div>
        </div>
        <div class="indicador">
          <div class="indicador__etiqueta">Registro oportuno</div>
          <div class="indicador__valor">{{ t.resumen.oportunidadPct }} <small>%</small></div>
          <div class="indicador__nota">de los seguimientos se registró a tiempo</div>
        </div>
      </div>

      <section class="tarjeta tarjeta--plana">
        <div class="tarjeta__cabecera">
          <div>
            <h2 class="tarjeta__titulo">Por estrategia</h2>
            <p class="secundario">Cada marca es el seguimiento de una semana, ubicado en el día en que el servidor lo recibió.</p>
          </div>
          <div class="leyenda">
            <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="#0ca30c" /></svg> A tiempo</span>
            <span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" fill="#d03b3b" transform="rotate(45 6 6)" /></svg> Tardío</span>
            <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="#fff" stroke="#9aa2b1" stroke-dasharray="2 2" /></svg> Sin reportar</span>
            <span><svg width="14" height="12"><rect width="14" height="12" fill="#e9ebf0" /></svg> Cierre del mes</span>
          </div>
        </div>
        @if (!t.estrategias.length) {
          <div class="vacio"><mat-icon>insights</mat-icon><strong>No hay estrategias para esta selección</strong>Ajuste los filtros o elija otro periodo.</div>
        } @else {
          <table class="tabla tabla--clic">
            <thead>
              <tr><th>Estrategia</th><th>Tutor</th><th>Docentes acompañados</th><th>Semanas con seguimiento</th><th>Cuándo se registró</th><th>Patrón del registro y cierre</th></tr>
            </thead>
            <tbody>
              @for (e of t.estrategias; track e.id) {
                <tr (click)="detalle(e)" matTooltip="Ver los registros que explican estas cifras" matTooltipShowDelay="700">
                  <td style="min-width: 210px"><strong>{{ e.nombre }}</strong><small>{{ e.entidadNombre }} · {{ e.territorio }}</small></td>
                  <td>@for (tutor of e.tutores; track tutor.id) {<div>{{ tutor.nombre }}</div>}</td>
                  <td><app-medidor [valor]="e.docentesAcompanados" [total]="e.docentesAsignados" /></td>
                  <td><app-medidor [valor]="e.semanasReportadas" [total]="e.semanasExigibles" /></td>
                  <td><app-distribucion [semanas]="e.semanas" [finDelMes]="finDelMes" /></td>
                  <td>
                    <app-chip [tono]="patron[e.patron].tono" [icono]="patron[e.patron].icono" [matTooltip]="patron[e.patron].ayuda">{{ patron[e.patron].etiqueta }}</app-chip>
                    @if (e.registrosOportunos + e.registrosTardios > 0) {
                      <small>{{ e.registrosOportunos }} a tiempo · {{ e.registrosTardios }} tardío(s)</small>
                    }
                    <div style="margin-top: 6px">
                      @if (e.periodo.estado === 'CERRADO') {
                        @if (e.periodo.extemporaneo) {<app-chip tono="aviso" icono="schedule">Cerrado fuera de plazo</app-chip>}
                        @else {<app-chip tono="bien" icono="lock">Periodo cerrado</app-chip>}
                      } @else {
                        <app-chip tono="neutro" icono="lock_open">Periodo abierto</app-chip>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (t.tutores.length) {
        <section class="tarjeta tarjeta--plana">
          <div class="tarjeta__cabecera">
            <div><h2 class="tarjeta__titulo">Por tutor</h2><p class="secundario">Consolidado de las estrategias que cada tutor tiene asignadas.</p></div>
          </div>
          <table class="tabla">
            <thead>
              <tr><th>Tutor</th><th class="centro">Estrategias</th><th>Docentes acompañados</th><th>Semanas con seguimiento</th><th>Registro oportuno</th><th>Patrón del registro</th><th>Cierres</th></tr>
            </thead>
            <tbody>
              @for (tutor of t.tutores; track tutor.id) {
                <tr>
                  <td style="min-width: 180px">
                    <div class="tutor-celda">
                      <strong>{{ tutor.nombre }}</strong>
                      <button mat-icon-button (click)="observar(tutor)" matTooltip="Enviar una observación al tutor" [attr.aria-label]="'Enviar una observación a ' + tutor.nombre"><mat-icon>feedback</mat-icon></button>
                    </div>
                  </td>
                  <td class="centro mono">{{ tutor.estrategias }}</td>
                  <td><app-medidor [valor]="tutor.docentesAcompanados" [total]="tutor.docentesAsignados" /></td>
                  <td><app-medidor [valor]="tutor.semanasReportadas" [total]="tutor.semanasExigibles" /></td>
                  <td><app-medidor [valor]="tutor.registrosOportunos" [total]="tutor.registrosOportunos + tutor.registrosTardios" /></td>
                  <td><app-chip [tono]="patron[tutor.patron].tono" [icono]="patron[tutor.patron].icono" [matTooltip]="patron[tutor.patron].ayuda">{{ patron[tutor.patron].etiqueta }}</app-chip></td>
                  <td>
                    {{ tutor.periodosCerrados }} de {{ tutor.estrategias }} cerrados
                    @if (tutor.cierresExtemporaneos) {<small class="tono--aviso">{{ tutor.cierresExtemporaneos }} fuera de plazo</small>}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }
    } @else if (!error()) {
      <div class="cargando">Calculando indicadores…</div>
    }
  `,
})
export class TableroComponent {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly patron = PATRON;
  readonly tablero = signal<Tablero | null>(null);
  readonly entidades = signal<Entidad[]>([]);
  readonly tutores = signal<Persona[]>([]);
  readonly error = signal('');

  periodos: { clave: string; nombre: string }[] = [];
  periodo = '';
  entidadId: number | null = null;
  tutorId: number | null = null;
  finDelMes = '';

  constructor() {
    this.api.entidades().subscribe((e) => this.entidades.set(e));
    this.api.tutores().subscribe((t) => this.tutores.set(t));
    // La fecha de referencia la da el servidor: el mes en curso y los cinco anteriores.
    this.api.listas().subscribe((listas) => {
      const [anio, mes] = listas.hoy.split('-').map(Number);
      for (let i = 0; i < 6; i++) {
        const indice = anio * 12 + (mes - 1) - i;
        const a = Math.floor(indice / 12);
        const m = (indice % 12) + 1;
        this.periodos.push({ clave: `${a}-${m}`, nombre: `${MESES[m - 1]} de ${a}${i === 0 ? ' (en curso)' : ''}` });
      }
      // Por defecto, el último mes completo: es el que ya puede evaluarse.
      this.periodo = this.periodos[1].clave;
      this.cargar();
    });
  }

  cargar(): void {
    const [anio, mes] = this.periodo.split('-').map(Number);
    this.finDelMes = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
    this.api.tablero({ anio, mes, entidadId: this.entidadId, tutorId: this.tutorId }).subscribe({
      next: (t) => {
        this.tablero.set(t);
        this.error.set('');
      },
      error: (e) => this.error.set(mensajeDe(e)),
    });
  }

  detalle(fila: FilaTablero): void {
    const [anio, mes] = this.periodo.split('-').map(Number);
    this.api.detalleTablero(fila.id, anio, mes).subscribe({
      next: (d) => this.dialogo.open(DetalleTableroDialogo, { data: d, width: '920px', maxWidth: '95vw' }),
      error: (e) => this.error.set(mensajeDe(e)),
    });
  }

  /** CU-11: observación dirigida al tutor, que le llega y queda registrada con el autor y la fecha. */
  observar(tutor: TutorTablero): void {
    const [anio, mes] = this.periodo.split('-').map(Number);
    const datos: DatosTexto = {
      titulo: `Observación para ${tutor.nombre}`,
      mensaje: `Sobre el periodo ${this.tablero()?.periodo.nombre}. Le llegará al tutor y quedará registrada con su usuario y la fecha.`,
      etiqueta: 'Observación', minimo: 10, aceptar: 'Enviar observación',
    };
    this.dialogo.open(TextoDialogo, { data: datos, width: '540px' }).afterClosed().subscribe((r?: RespuestaTexto) => {
      if (!r) return;
      this.api.crearObservacion({ tutorId: tutor.id, anio, mes, texto: r.texto }).subscribe({
        next: () => this.avisos.open(`Observación enviada a ${tutor.nombre}.`, 'Cerrar'),
        error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
      });
    });
  }

  /** Exporta el consolidado; si hay periodos abiertos, el archivo lleva la marca de preliminar (RQ_011). */
  exportar(): void {
    const t = this.tablero();
    if (!t) return;
    const celda = (v: unknown) => { const x = String(v ?? ''); return /[";\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const filas: unknown[][] = [
      [`Tablero de cumplimiento SSES - ${t.periodo.nombre}`],
      [t.periodo.preliminar ? 'PRELIMINAR - NO OFICIAL: ' + t.periodo.advertencia : 'Cifras definitivas: todos los periodos están cerrados'],
      [],
      ['Estrategia', 'Entidad', 'Territorio', 'Tutores', 'Docentes acompañados', 'Docentes asignados', 'Acompañamientos individuales', 'Sesiones grupales', 'Semanas reportadas', 'Semanas exigibles', 'Registro oportuno %', 'Patrón', 'Periodo'],
      ...t.estrategias.map((e) => [e.nombre, e.entidadNombre, e.territorio, e.tutores.map((x) => x.nombre).join(' / '), e.docentesAcompanados, e.docentesAsignados,
        e.acompanamientosIndividuales, e.sesionesGrupales, e.semanasReportadas, e.semanasExigibles, e.oportunidadPct, PATRON[e.patron].etiqueta,
        e.periodo.estado === 'CERRADO' ? (e.periodo.extemporaneo ? 'Cerrado fuera de plazo' : 'Cerrado') : 'Abierto']),
      [],
      ['Tutor', 'Estrategias', 'Acompañamientos registrados', 'Semanas reportadas', 'Semanas exigibles', 'Registro oportuno %', 'Patrón', 'Periodos cerrados', 'Cierres fuera de plazo'],
      ...t.tutores.map((x) => [x.nombre, x.estrategias, x.acompanamientos, x.semanasReportadas, x.semanasExigibles, x.oportunidadPct, PATRON[x.patron].etiqueta, x.periodosCerrados, x.cierresExtemporaneos]),
    ];
    const csv = '\ufeff' + filas.map((f) => f.map(celda).join(';')).join('\r\n');
    guardarArchivo(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `tablero-${this.periodo}.csv`);
  }
}
