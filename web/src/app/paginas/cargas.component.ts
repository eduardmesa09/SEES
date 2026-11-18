import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../core/api.service';
import { ChipComponent, ConfirmarDialogo, DatosConfirmacion, MATERIAL, errorApi, guardarArchivo, mensajeDe } from '../core/compartido';
import { CargaHistorial, EntidadConCarga, ResultadoCarga } from '../core/modelos';

const TIPOS = [
  { valor: 'entidades', etiqueta: 'Entidades', columnas: 'codigo, nombre, municipio, territorio' },
  { valor: 'estudiantes', etiqueta: 'Estudiantes', columnas: 'tipo_documento, documento, nombres, apellidos, grado, codigo_entidad' },
  { valor: 'docentes', etiqueta: 'Docentes', columnas: 'documento, nombre, area, codigo_entidad' },
];

/**
 * CU-14 / RQ_014: carga inicial de entidades, estudiantes y docentes desde la plantilla definida.
 * El informe indica cuántos registros se aceptaron y, para cada rechazo, la fila y el motivo exacto.
 */
@Component({
  selector: 'app-cargas',
  standalone: true,
  imports: [FormsModule, DatePipe, TitleCasePipe, ChipComponent, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Cargas masivas</h1>
        <p class="pagina__sub">Información precargada que el Ministerio entrega: entidades, estudiantes y docentes. De la calidad de esta carga depende todo lo demás.</p>
      </div>
    </header>

    <section class="tarjeta">
      <div class="carga">
        <mat-form-field>
          <mat-label>¿Qué va a cargar?</mat-label>
          <mat-select [(ngModel)]="tipo" (ngModelChange)="resultado.set(null); error.set('')">
            @for (t of tipos; track t.valor) {<mat-option [value]="t.valor">{{ t.etiqueta }}</mat-option>}
          </mat-select>
        </mat-form-field>
        <button mat-stroked-button (click)="plantilla()"><mat-icon>description</mat-icon> Descargar plantilla</button>
        <label class="carga__archivo">
          <input type="file" accept=".csv,text/csv" (change)="elegir($event)" />
          <span><mat-icon>upload_file</mat-icon> {{ archivo ? archivo.name : 'Elegir archivo CSV' }}</span>
        </label>
        <button mat-flat-button color="primary" (click)="cargar()" [disabled]="!archivo || cargando()">{{ cargando() ? 'Validando…' : 'Validar y cargar' }}</button>
      </div>
      <p class="tenue" style="font-size: 12.5px; margin-top: 22px">Columnas de la plantilla: <span class="codigo">{{ columnas() }}</span>. Se aceptan coma o punto y coma como separador.</p>
    </section>

    @if (error()) {
      <div class="aviso aviso--critico" style="margin-top: 18px">
        <mat-icon>error</mat-icon>
        <div>
          <strong>{{ error() }}</strong>
          @if (estructura(); as e) {
            @if (e.faltan.length) {<p>Faltan las columnas: <span class="codigo">{{ e.faltan.join(', ') }}</span></p>}
            @if (e.sobran.length) {<p>Sobran las columnas: <span class="codigo">{{ e.sobran.join(', ') }}</span></p>}
          }
        </div>
      </div>
    }

    @if (resultado(); as r) {
      <section class="tarjeta" style="margin-top: 18px">
        <h2 class="tarjeta__titulo">Informe de la carga · {{ r.archivo }}</h2>
        <div class="resumen-cierre">
          <div><span>Filas del archivo</span><strong>{{ r.filas }}</strong></div>
          <div><span>Aceptadas</span><strong class="tono--bien">{{ r.aceptados }}</strong></div>
          <div><span>Rechazadas</span><strong [class.tono--critico]="r.rechazados > 0">{{ r.rechazados }}</strong></div>
          <div><span>Consolidadas por documento repetido</span><strong>{{ r.consolidados }}</strong></div>
        </div>
      </section>
      @if (r.rechazos.length) {
        <section class="tarjeta tarjeta--plana">
          <div class="tarjeta__cabecera"><div><h2 class="tarjeta__titulo">Filas rechazadas</h2><p class="secundario">Corríjalas en el archivo y vuelva a cargarlo: las ya aceptadas se informarán como existentes.</p></div></div>
          <table class="tabla tabla--compacta">
            <thead><tr><th>Fila</th><th>Documento o código</th><th>Motivo</th></tr></thead>
            <tbody>
              @for (x of r.rechazos; track x.fila) {
                <tr><td class="mono">{{ x.fila }}</td><td class="mono">{{ x.documento }}</td><td>{{ x.motivo }}</td></tr>
              }
            </tbody>
          </table>
        </section>
      }
    }

    <section class="tarjeta tarjeta--plana" style="margin-top: 18px">
      <mat-tab-group animationDuration="0ms">
        <mat-tab label="Información precargada por entidad">
          <table class="tabla tabla--compacta">
            <thead><tr><th>Entidad</th><th>Territorio</th><th class="centro">Estudiantes</th><th class="centro">Docentes</th></tr></thead>
            <tbody>
              @for (e of entidades(); track e.id) {
                <tr>
                  <td><strong>{{ e.nombre }}</strong><small>{{ e.codigo }} · {{ e.municipio }}</small></td>
                  <td>{{ e.territorio }}</td>
                  <td class="centro mono">@if (e.estudiantes) { {{ e.estudiantes }} } @else {<app-chip tono="aviso" icono="warning">Sin carga</app-chip>}</td>
                  <td class="centro mono">@if (e.docentes) { {{ e.docentes }} } @else {<app-chip tono="aviso" icono="warning">Sin carga</app-chip>}</td>
                </tr>
              }
            </tbody>
          </table>
        </mat-tab>
        <mat-tab [label]="'Historial de cargas (' + historial().length + ')'">
          @if (!historial().length) {
            <div class="vacio"><mat-icon>history</mat-icon><strong>Aún no hay cargas</strong>La información inicial del MVP llegó por los datos sintéticos.</div>
          } @else {
            <table class="tabla tabla--compacta">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Archivo</th><th class="centro">Filas</th><th class="centro">Aceptadas</th><th class="centro">Rechazadas</th><th>Cargado por</th></tr></thead>
              <tbody>
                @for (c of historial(); track c.id) {
                  <tr>
                    <td class="nowrap">{{ c.cargadoEn | date: 'd MMM y, h:mm a' }}</td>
                    <td>{{ c.tipo | titlecase }}</td>
                    <td class="codigo">{{ c.archivo }}</td>
                    <td class="centro mono">{{ c.filas }}</td>
                    <td class="centro mono">{{ c.aceptados }}</td>
                    <td class="centro mono">{{ c.rechazados }}</td>
                    <td>{{ c.cargadoPor }}</td>
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
export class CargasComponent {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly tipos = TIPOS;
  tipo = 'docentes';
  archivo: File | null = null;
  readonly resultado = signal<ResultadoCarga | null>(null);
  readonly error = signal('');
  readonly estructura = signal<{ faltan: string[]; sobran: string[] } | null>(null);
  readonly cargando = signal(false);
  readonly entidades = signal<EntidadConCarga[]>([]);
  readonly historial = signal<CargaHistorial[]>([]);

  constructor() {
    this.refrescar();
  }

  private refrescar(): void {
    this.api.entidadesConCarga().subscribe((e) => this.entidades.set(e));
    this.api.cargas().subscribe((c) => this.historial.set(c));
  }

  columnas(): string {
    return TIPOS.find((t) => t.valor === this.tipo)?.columnas ?? '';
  }

  plantilla(): void {
    this.api.plantilla(this.tipo).subscribe({
      next: (archivo) => guardarArchivo(archivo, `plantilla-${this.tipo}.csv`),
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }

  elegir(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    this.archivo = entrada.files?.[0] ?? null;
    this.resultado.set(null);
    this.error.set('');
  }

  async cargar(consolidar = false): Promise<void> {
    if (!this.archivo) return;
    const contenido = await this.archivo.text();
    const nombre = this.archivo.name;
    this.cargando.set(true);
    this.error.set('');
    this.estructura.set(null);
    this.api.cargar(this.tipo, nombre, contenido, consolidar).subscribe({
      next: (r) => {
        this.cargando.set(false);
        this.resultado.set(r);
        this.refrescar();
      },
      error: (e) => {
        this.cargando.set(false);
        const detalle = errorApi(e);
        if (detalle?.codigo === 'DOCUMENTOS_REPETIDOS') {
          const repetidos = detalle['repetidos'] as { clave: string; filas: number[] }[];
          const datos: DatosConfirmacion = {
            titulo: 'El archivo tiene documentos repetidos',
            mensaje: detalle.mensaje,
            detalles: repetidos.slice(0, 8).map((r) => `${r.clave}: filas ${r.filas.join(', ')}`),
            aceptar: 'Consolidar y continuar', icono: 'content_copy', tono: 'aviso',
          };
          this.dialogo.open(ConfirmarDialogo, { data: datos, width: '540px' }).afterClosed().subscribe((ok) => ok && this.cargar(true));
          return;
        }
        if (detalle?.codigo === 'PLANTILLA_INVALIDA') {
          this.estructura.set({ faltan: detalle['faltan'] as string[], sobran: detalle['sobran'] as string[] });
        }
        this.error.set(mensajeDe(e));
      },
    });
  }
}
