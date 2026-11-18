import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../core/api.service';
import {
  ChipComponent, ConfirmarDialogo, DatosConfirmacion, DatosTexto, MATERIAL, RespuestaTexto, TextoDialogo, guardarArchivo,
  mensajeDe, mesesRecientes,
} from '../core/compartido';
import { Certificado, ReporteDeLey } from '../core/modelos';
import { ConsolidadoComponent } from './consolidado.component';

/**
 * CU-12 / RQ_012: reportes de ley. Solo se certifican periodos cerrados (RN-09); lo que no esté cerrado
 * se espera o se excluye con constancia del motivo. La certificación congela el resultado.
 */
@Component({
  selector: 'app-reportes-ley',
  standalone: true,
  imports: [FormsModule, DatePipe, ChipComponent, ConsolidadoComponent, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Reportes de ley</h1>
        <p class="pagina__sub">Consolidado mensual del programa. Se certifica solo sobre periodos cerrados y, una vez certificado, queda congelado con su identificador de verificación.</p>
      </div>
      @if (reporte()) {
        <div class="pagina__acciones">
          <button mat-stroked-button (click)="descargar()"><mat-icon>download</mat-icon> Descargar preliminar</button>
          <button mat-flat-button color="primary" (click)="certificar()" [disabled]="!reporte()!.certificable || !reporte()!.mesTerminado">
            <mat-icon>verified</mat-icon> {{ reporte()!.versiones.length ? 'Recertificar' : 'Certificar' }}
          </button>
        </div>
      }
    </header>

    <div class="filtros">
      <mat-form-field>
        <mat-label>Periodo a certificar</mat-label>
        <mat-select [(ngModel)]="periodo" (ngModelChange)="reiniciar()">
          @for (p of periodos; track p.clave) {<mat-option [value]="p.clave">{{ p.nombre }}{{ p.enCurso ? ' (en curso)' : '' }}</mat-option>}
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Alcance territorial</mat-label>
        <mat-select [(ngModel)]="territorio" (ngModelChange)="reiniciar()">
          <mat-option value="">Todo mi territorio</mat-option>
          @for (t of territorios(); track t) {<mat-option [value]="t">{{ t }}</mat-option>}
        </mat-select>
      </mat-form-field>
    </div>

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
    }

    @if (reporte(); as r) {
      @if (r.versiones.length; as n) {
        <div class="aviso aviso--bien">
          <mat-icon>verified</mat-icon>
          <div>
            <strong>Certificado · versión {{ r.versiones[0].version }} · <span class="codigo">{{ r.versiones[0].codigoVerificacion }}</span></strong>
            <p>
              Por {{ r.versiones[0].certificadoPor }} el {{ r.versiones[0].certificadoEn | date: 'd MMM y, h:mm a' }}.
              @if (n > 1) { Hay {{ n - 1 }} versión(es) anterior(es) conservada(s). }
              Una nueva certificación exige justificar el ajuste y no sobrescribe la anterior.
            </p>
          </div>
        </div>
      }
      @if (!r.mesTerminado) {
        <div class="aviso aviso--aviso"><mat-icon>schedule</mat-icon><div><strong>El mes aún no ha terminado</strong><p>Puede ver el consolidado preliminar, pero no certificarlo.</p></div></div>
      } @else if (r.pendientes.length) {
        <div class="aviso aviso--critico">
          <mat-icon>lock_open</mat-icon>
          <div>
            <strong>{{ r.pendientes.length }} periodo(s) sin cerrar: no se puede certificar</strong>
            <p>Espere a que los tutores los cierren o exclúyalos dejando constancia del motivo, que quedará impresa en el reporte.</p>
          </div>
        </div>
      } @else if (r.certificable) {
        <div class="aviso aviso--info"><mat-icon>task_alt</mat-icon><div><strong>Listo para certificar</strong><p>Todos los periodos incluidos están cerrados.</p></div></div>
      }

      @if (r.pendientes.length || exclusiones.size) {
        <section class="tarjeta tarjeta--plana" style="margin-bottom: 18px">
          <div class="tarjeta__cabecera"><h2 class="tarjeta__titulo">Periodos abiertos y exclusiones</h2></div>
          <table class="tabla tabla--compacta">
            <thead><tr><th>Estrategia</th><th>Tutor con el periodo pendiente</th><th>Situación</th><th></th></tr></thead>
            <tbody>
              @for (p of r.pendientes; track p.estrategiaId) {
                <tr>
                  <td><strong>{{ p.nombre }}</strong><small>{{ p.codigo }} · {{ p.entidadNombre }}</small></td>
                  <td>{{ p.tutores.join(', ') }}</td>
                  <td><app-chip tono="aviso" icono="lock_open">Periodo abierto</app-chip></td>
                  <td class="derecha"><button mat-button (click)="excluir(p.estrategiaId, p.nombre)"><mat-icon>remove_circle_outline</mat-icon> Excluir</button></td>
                </tr>
              }
              @for (x of listaExclusiones(); track x.id) {
                <tr>
                  <td><strong>{{ x.nombre }}</strong></td>
                  <td colspan="1">{{ x.motivo }}</td>
                  <td><app-chip tono="neutro" icono="block">Excluida</app-chip></td>
                  <td class="derecha"><button mat-button (click)="incluir(x.id)"><mat-icon>undo</mat-icon> Volver a incluir</button></td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }

      <app-consolidado [cifras]="r.cifras" [cobertura]="r.coberturaInformacion" [grupos]="r.porTerritorio" />
      <div style="margin-top: 18px">
        <app-consolidado [cifras]="r.cifras" [cobertura]="r.coberturaInformacion" [grupos]="r.porEntidad" tituloGrupos="Por entidad" columnaGrupo="Entidad" [conIndicadores]="false" />
      </div>
    } @else if (!error()) {
      <div class="cargando">Consolidando…</div>
    }

    <section class="tarjeta tarjeta--plana" style="margin-top: 18px">
      <div class="tarjeta__cabecera">
        <div><h2 class="tarjeta__titulo">Reportes certificados</h2><p class="secundario">Cada versión es inmutable. La vigente es la de mayor número.</p></div>
        <div style="display: flex; gap: 8px; align-items: center">
          <mat-form-field style="width: 230px; margin-bottom: -18px">
            <mat-label>Verificar un código</mat-label>
            <input matInput [(ngModel)]="codigo" placeholder="SSES-…" />
          </mat-form-field>
          <button mat-stroked-button (click)="verificar()" [disabled]="!codigo.trim()">Verificar</button>
        </div>
      </div>
      @if (!certificados().length) {
        <div class="vacio"><mat-icon>verified</mat-icon><strong>Aún no hay reportes certificados</strong></div>
      } @else {
        <table class="tabla tabla--compacta">
          <thead><tr><th>Periodo</th><th>Alcance</th><th>Versión</th><th>Código de verificación</th><th>Certificado por</th><th>Cobertura</th><th></th></tr></thead>
          <tbody>
            @for (c of certificados(); track c.id) {
              <tr>
                <td class="nowrap">{{ c.periodo }}</td>
                <td>{{ c.alcance === 'TODOS' ? 'Todo el territorio' : c.alcance }}</td>
                <td>v{{ c.version }}@if (c.motivoAjuste) {<small>{{ c.motivoAjuste }}</small>}</td>
                <td class="codigo">{{ c.codigoVerificacion }}</td>
                <td>{{ c.certificadoPor }}<small>{{ c.certificadoEn | date: 'd MMM y, h:mm a' }}</small></td>
                <td class="mono">{{ c.coberturaInformacion.porcentaje }} %@if (c.exclusiones) {<small>{{ c.exclusiones }} exclusión(es)</small>}</td>
                <td>@if (c.vigente) {<app-chip tono="bien" icono="verified">Vigente</app-chip>} @else {<app-chip tono="neutro" icono="history">Versión anterior</app-chip>}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class ReportesLeyComponent {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly reporte = signal<ReporteDeLey | null>(null);
  readonly certificados = signal<Certificado[]>([]);
  readonly territorios = signal<string[]>([]);
  readonly error = signal('');

  periodos: ReturnType<typeof mesesRecientes> = [];
  periodo = '';
  territorio = '';
  codigo = '';
  /** Estrategias excluidas del reporte, con el motivo que queda impreso. */
  readonly exclusiones = new Map<number, { nombre: string; motivo: string }>();

  constructor() {
    this.api.territorios().subscribe((t) => this.territorios.set(t));
    this.api.listas().subscribe((listas) => {
      this.periodos = mesesRecientes(listas.hoy);
      this.periodo = this.periodos[1].clave;
      this.cargar();
    });
    this.cargarCertificados();
  }

  private filtros() {
    const [anio, mes] = this.periodo.split('-').map(Number);
    return { anio, mes, territorio: this.territorio };
  }

  reiniciar(): void {
    this.exclusiones.clear();
    this.cargar();
  }

  cargar(): void {
    this.api.reporteDeLey({ ...this.filtros(), excluir: [...this.exclusiones.keys()].join(',') }).subscribe({
      next: (r) => { this.reporte.set(r); this.error.set(''); },
      error: (e) => this.error.set(mensajeDe(e)),
    });
  }

  private cargarCertificados(): void {
    this.api.certificados().subscribe({ next: (c) => this.certificados.set(c), error: () => undefined });
  }

  listaExclusiones() {
    return [...this.exclusiones.entries()].map(([id, x]) => ({ id, ...x }));
  }

  excluir(id: number, nombre: string): void {
    const datos: DatosTexto = {
      titulo: `Excluir ${nombre} del reporte`,
      mensaje: 'La exclusión y su motivo quedarán impresos en el reporte certificado.',
      etiqueta: 'Motivo de la exclusión', minimo: 10, aceptar: 'Excluir',
    };
    this.dialogo.open(TextoDialogo, { data: datos, width: '520px' }).afterClosed().subscribe((r?: RespuestaTexto) => {
      if (!r) return;
      this.exclusiones.set(id, { nombre, motivo: r.texto });
      this.cargar();
    });
  }

  incluir(id: number): void {
    this.exclusiones.delete(id);
    this.cargar();
  }

  certificar(): void {
    const r = this.reporte();
    if (!r) return;
    const cuerpo = (motivoAjuste?: string) => ({
      ...this.filtros(),
      territorio: this.territorio || undefined,
      exclusiones: this.listaExclusiones().map((x) => ({ estrategiaId: x.id, motivo: x.motivo })),
      motivoAjuste,
    });
    const enviar = (motivoAjuste?: string) =>
      this.api.certificar(cuerpo(motivoAjuste)).subscribe({
        next: (c) => {
          this.avisos.open(`Reporte certificado (versión ${c.version}). Código de verificación: ${c.codigoVerificacion}`, 'Cerrar', { duration: 8000 });
          this.cargar();
          this.cargarCertificados();
        },
        error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
      });

    const detalles = [
      `${r.cifras.estrategiasActivas} estrategias, ${r.cifras.estudiantesVinculados} estudiantes, ${r.cifras.docentesAcompanados} docentes acompañados`,
      `Cobertura de información: ${r.coberturaInformacion.porcentaje} %`,
      ...this.listaExclusiones().map((x) => `Excluida: ${x.nombre} (${x.motivo})`),
    ];
    if (r.versiones.length) {
      const datos: DatosTexto = {
        titulo: `Recertificar ${r.periodo.nombre}`,
        mensaje: `Ya existe la versión ${r.versiones[0].version}. Se generará una nueva versión y la anterior se conservará íntegra; el ente de control verá que existe.`,
        detalles, etiqueta: 'Justificación del ajuste', minimo: 10, aceptar: 'Certificar nueva versión',
      };
      this.dialogo.open(TextoDialogo, { data: datos, width: '580px' }).afterClosed().subscribe((x?: RespuestaTexto) => x && enviar(x.texto));
      return;
    }
    const datos: DatosConfirmacion = {
      titulo: `Certificar ${r.periodo.nombre}`,
      mensaje: 'El reporte quedará congelado con su usuario, la fecha y un identificador de verificación. No podrá modificarse.',
      detalles, aceptar: 'Certificar', icono: 'verified', tono: 'info',
    };
    this.dialogo.open(ConfirmarDialogo, { data: datos, width: '560px' }).afterClosed().subscribe((ok) => ok && enviar());
  }

  descargar(): void {
    this.api.descargaReporteDeLey(this.filtros()).subscribe({
      next: (archivo) => guardarArchivo(archivo, `reporte-preliminar-${this.periodo}.csv`),
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }

  verificar(): void {
    this.api.verificar(this.codigo).subscribe({
      next: (c) => {
        const datos: DatosConfirmacion = {
          titulo: 'Código auténtico',
          mensaje: `Corresponde al reporte de ${c.periodo} (${c.alcance === 'TODOS' ? 'todo el territorio' : c.alcance}), versión ${c.version}, certificado por ${c.certificadoPor}.`,
          detalles: [c.vigente ? 'Es la versión vigente.' : 'Existe una versión posterior: esta ya no es la vigente.'],
          aceptar: 'Entendido', cancelar: null, icono: 'verified', tono: 'bien',
        };
        this.dialogo.open(ConfirmarDialogo, { data: datos, width: '520px' });
      },
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }
}
