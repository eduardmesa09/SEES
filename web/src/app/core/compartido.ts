import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Input, Pipe, PipeTransform, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ErrorApi, EstadoSemana, Patron, Perfil, SemanaDelTablero } from './modelos';

/** Módulos de Angular Material que usan las pantallas. */
export const MATERIAL = [
  MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
  MatPaginatorModule, MatProgressBarModule, MatSelectModule, MatSlideToggleModule, MatSnackBarModule,
  MatTabsModule, MatTooltipModule,
] as const;

// ------------------------------------------------------------------ Fechas y textos

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Formatea una fecha AAAA-MM-DD sin pasar por zonas horarias: "5 oct 2026" o, en corto, "5 oct". */
export function fechaLegible(fecha: string | null | undefined, corta = false): string {
  if (!fecha) return '';
  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number);
  return corta ? `${dia} ${MESES_CORTOS[mes - 1]}` : `${dia} ${MESES_CORTOS[mes - 1]} ${anio}`;
}

@Pipe({ name: 'fecha', standalone: true })
export class FechaPipe implements PipeTransform {
  transform(fecha: string | null | undefined, formato: 'larga' | 'corta' = 'larga'): string {
    return fechaLegible(fecha, formato === 'corta');
  }
}

export function diasEntre(desde: string, hasta: string): number {
  const utc = (f: string) => { const [a, m, d] = f.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((utc(hasta) - utc(desde)) / 86_400_000);
}

export const ETIQUETA_PERFIL: Record<Perfil, string> = {
  TUTOR: 'Tutor',
  TUTOR_LIDER: 'Tutor líder',
  ENTE_CONTROL: 'Ente de control (consulta)',
  ADMIN: 'Administrador del sistema',
  SOPORTE: 'Ingeniero de soporte',
};

/** Guarda en el equipo un archivo recibido del servidor. */
export function guardarArchivo(contenido: Blob, nombre: string): void {
  const url = URL.createObjectURL(contenido);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ETIQUETA_MODALIDAD: Record<string, string> = {
  PRESENCIAL: 'Presencial',
  VIRTUAL: 'Virtual',
  MIXTA: 'Mixta',
};

export type Tono = 'bien' | 'aviso' | 'serio' | 'critico' | 'neutro' | 'info';

/** Los estados se comunican siempre con ícono y texto, nunca solo con color. */
export const PATRON: Record<Patron, { etiqueta: string; icono: string; tono: Tono; ayuda: string }> = {
  SOSTENIDO: { etiqueta: 'Sostenido', icono: 'check_circle', tono: 'bien', ayuda: 'La mayoría de los registros se hizo a tiempo, semana a semana.' },
  CONCENTRADO_AL_CIERRE: { etiqueta: 'Concentrado al cierre', icono: 'error', tono: 'critico', ayuda: 'La mayoría de los registros se hizo en los últimos tres días del mes o después.' },
  IRREGULAR: { etiqueta: 'Irregular', icono: 'warning', tono: 'aviso', ayuda: 'Registros tardíos, aunque repartidos a lo largo del mes.' },
  SIN_REGISTROS: { etiqueta: 'Sin registros', icono: 'remove_circle_outline', tono: 'neutro', ayuda: 'No hay seguimientos semanales en el periodo.' },
};

export const ESTADO_SEMANA: Record<EstadoSemana, { etiqueta: string; icono: string; tono: Tono }> = {
  REPORTADA: { etiqueta: 'Reportada', icono: 'check_circle', tono: 'bien' },
  SIN_ACTIVIDAD: { etiqueta: 'Reportada sin actividad', icono: 'event_busy', tono: 'info' },
  PENDIENTE: { etiqueta: 'Pendiente', icono: 'warning', tono: 'aviso' },
  EN_CURSO: { etiqueta: 'En curso', icono: 'schedule', tono: 'info' },
  FUTURA: { etiqueta: 'Aún no ocurre', icono: 'lock_clock', tono: 'neutro' },
};

/** Mensaje legible de un error del API. */
export function mensajeDe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'No fue posible conectar con el servidor. Verifique que el Piloto esté en ejecución.';
    return (error.error as ErrorApi | null)?.mensaje ?? `Error ${error.status}`;
  }
  return 'Ocurrió un error inesperado.';
}

export function errorApi(error: unknown): ErrorApi | null {
  return error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' ? (error.error as ErrorApi) : null;
}

// ------------------------------------------------------------------ Componentes pequeños

/** Etiqueta de estado: ícono + texto sobre un fondo tenue. */
@Component({
  selector: 'app-chip',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip chip--{{ tono }}">@if (icono) {<mat-icon>{{ icono }}</mat-icon>}<ng-content /></span>`,
})
export class ChipComponent {
  @Input() tono: Tono = 'neutro';
  @Input() icono = '';
}

/** Medidor: una razón contra su total, con la cifra a la vista. */
@Component({
  selector: 'app-medidor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="medidor" [attr.title]="valor + ' de ' + total + ' (' + pct + ' %)'">
      <div class="medidor__cifra"><strong>{{ valor }}</strong> / {{ total }} <span>{{ pct }} %</span></div>
      <div class="medidor__pista" role="progressbar" [attr.aria-valuenow]="pct" aria-valuemin="0" aria-valuemax="100">
        <div class="medidor__relleno" [style.width.%]="pct"></div>
      </div>
    </div>
  `,
})
export class MedidorComponent {
  @Input() valor = 0;
  @Input() total = 0;
  get pct(): number {
    return this.total > 0 ? Math.min(100, Math.round((this.valor * 100) / this.total)) : 0;
  }
}

interface MarcaDistribucion {
  x: number;
  y: number;
  tipo: 'oportuno' | 'tardio' | 'ausente';
  titulo: string;
}

/**
 * Distribución temporal del registro: una marca por semana, ubicada en el día en que el
 * servidor recibió el seguimiento. Un trabajo sostenido deja marcas repartidas en el mes;
 * uno concentrado al cierre las apila al final. La forma refuerza al color:
 * círculo = a tiempo, rombo = tardío, círculo vacío = sin reportar.
 */
@Component({
  selector: 'app-distribucion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="distribucion" [attr.viewBox]="'0 0 ' + ancho + ' ' + alto" [attr.width]="ancho" [attr.height]="alto" role="img"
         [attr.aria-label]="descripcion">
      <rect [attr.x]="xCierre" y="2" [attr.width]="ancho - xCierre" [attr.height]="alto - 12" class="distribucion__cierre">
        <title>Últimos tres días del mes y días posteriores</title>
      </rect>
      <line x1="0" [attr.x2]="ancho" [attr.y1]="alto - 10" [attr.y2]="alto - 10" class="distribucion__eje" />
      @for (corte of cortes; track corte) {
        <line [attr.x1]="corte" [attr.x2]="corte" [attr.y1]="alto - 13" [attr.y2]="alto - 7" class="distribucion__eje" />
      }
      @for (marca of marcas; track $index) {
        <g class="distribucion__marca distribucion__marca--{{ marca.tipo }}">
          <title>{{ marca.titulo }}</title>
          <rect [attr.x]="marca.x - 9" y="0" width="18" [attr.height]="alto" fill="transparent" />
          @if (marca.tipo === 'tardio') {
            <rect [attr.x]="marca.x - 4" [attr.y]="marca.y - 4" width="8" height="8" [attr.transform]="'rotate(45 ' + marca.x + ' ' + marca.y + ')'" />
          } @else {
            <circle [attr.cx]="marca.x" [attr.cy]="marca.y" r="4.5" />
          }
        </g>
      }
      <text x="0" [attr.y]="alto - 1" class="distribucion__texto">{{ etiquetaInicio }}</text>
      <text [attr.x]="xCierre" [attr.y]="alto - 1" class="distribucion__texto" text-anchor="middle">cierre</text>
    </svg>
  `,
})
export class DistribucionComponent {
  readonly ancho = 190;
  readonly alto = 46;
  private semanasInternas: SemanaDelTablero[] = [];
  private fin = '';
  marcas: MarcaDistribucion[] = [];
  cortes: number[] = [];
  xCierre = 0;
  etiquetaInicio = '';
  descripcion = '';

  @Input({ required: true }) set semanas(valor: SemanaDelTablero[]) { this.semanasInternas = valor; this.calcular(); }
  @Input({ required: true }) set finDelMes(valor: string) { this.fin = valor; this.calcular(); }

  private calcular(): void {
    const semanas = this.semanasInternas;
    if (!semanas.length || !this.fin) { this.marcas = []; return; }

    const inicio = semanas[0].inicio;
    // El eje llega una semana más allá del fin del mes; lo registrado después se acumula en el borde.
    const dias = diasEntre(inicio, this.fin) + 8;
    const margen = 8;
    const escala = (fecha: string) => margen + (Math.min(Math.max(diasEntre(inicio, fecha), 0), dias) / dias) * (this.ancho - 2 * margen);

    this.xCierre = escala(this.fin) - (2 / dias) * (this.ancho - 2 * margen);
    this.cortes = semanas.map((s) => escala(s.inicio));
    this.etiquetaInicio = fechaLegible(inicio, true);

    const base = this.alto - 22;
    const ocupadas: number[] = [];
    this.marcas = semanas.map((semana) => {
      const rango = `Semana ${semana.semanaIso} (${fechaLegible(semana.inicio, true)} a ${fechaLegible(semana.fin, true)})`;
      if (!semana.registro) {
        // La semana sin reporte se dibuja sobre el eje, en el día en que terminó, para no confundirse con un registro.
        return { x: escala(semana.fin), y: this.alto - 10, tipo: 'ausente', titulo: `${rango}: sin reportar` } as MarcaDistribucion;
      }
      const x = escala(semana.registro.fechaRegistro);
      // Las marcas que caen el mismo día se apilan hacia arriba para que el amontonamiento se vea.
      const nivel = ocupadas.filter((o) => Math.abs(o - x) < 7).length;
      ocupadas.push(x);
      const cuando = semana.registro.oportuno
        ? 'a tiempo'
        : `${semana.registro.diasRetraso} día(s) después de terminar la semana`;
      return {
        x,
        y: base - nivel * 8,
        tipo: semana.registro.oportuno ? 'oportuno' : 'tardio',
        titulo: `${rango}: registrada el ${fechaLegible(semana.registro.fechaRegistro)}, ${cuando}`,
      } as MarcaDistribucion;
    });

    const tardias = this.marcas.filter((m) => m.tipo === 'tardio').length;
    const ausentes = this.marcas.filter((m) => m.tipo === 'ausente').length;
    this.descripcion = `${semanas.length} semanas: ${semanas.length - tardias - ausentes} registradas a tiempo, ${tardias} tardías y ${ausentes} sin reportar.`;
  }
}

// ------------------------------------------------------------------ Diálogo de confirmación

export interface DatosConfirmacion {
  titulo: string;
  mensaje: string;
  detalles?: string[];
  aceptar?: string;
  cancelar?: string | null;
  icono?: string;
  tono?: Tono;
}

@Component({
  selector: 'app-confirmar',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="dialogo__titulo">
      @if (datos.icono) {<mat-icon class="tono--{{ datos.tono ?? 'info' }}">{{ datos.icono }}</mat-icon>}
      {{ datos.titulo }}
    </h2>
    <mat-dialog-content>
      <p class="dialogo__mensaje">{{ datos.mensaje }}</p>
      @if (datos.detalles?.length) {
        <ul class="dialogo__lista">
          @for (detalle of datos.detalles; track $index) {<li>{{ detalle }}</li>}
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (datos.cancelar !== null) {<button mat-button [mat-dialog-close]="false">{{ datos.cancelar ?? 'Cancelar' }}</button>}
      <button mat-flat-button color="primary" [mat-dialog-close]="true" cdkFocusInitial>{{ datos.aceptar ?? 'Aceptar' }}</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmarDialogo {
  readonly datos = inject<DatosConfirmacion>(MAT_DIALOG_DATA);
}

// ------------------------------------------------------------------ Diálogo de texto (justificaciones, motivos)

export interface DatosTexto {
  titulo: string;
  mensaje?: string;
  detalles?: string[];
  etiqueta: string;
  minimo?: number;
  opciones?: string[];
  fecha?: { etiqueta: string; valor: string; min?: string; max?: string };
  aceptar?: string;
  /** Si existe, el diálogo ofrece dos salidas: aprobar (true) o rechazar (false). */
  decision?: { aprobar: string; rechazar: string };
}

export interface RespuestaTexto { texto: string; fecha?: string; aprobar?: boolean }

/** Pide un texto obligatorio (y opcionalmente una fecha o una opción de lista) antes de confirmar. */
@Component({
  selector: 'app-texto-dialogo',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ datos.titulo }}</h2>
    <mat-dialog-content>
      @if (datos.mensaje) {<p class="dialogo__mensaje">{{ datos.mensaje }}</p>}
      @if (datos.detalles?.length) {
        <ul class="dialogo__lista">@for (d of datos.detalles; track $index) {<li>{{ d }}</li>}</ul>
      }
      <div style="margin-top: 16px">
        @if (datos.opciones) {
          <mat-form-field style="width: 100%">
            <mat-label>{{ datos.etiqueta }}</mat-label>
            <mat-select [(ngModel)]="texto">
              @for (o of datos.opciones; track o) {<mat-option [value]="o">{{ o }}</mat-option>}
            </mat-select>
          </mat-form-field>
        } @else {
          <mat-form-field style="width: 100%">
            <mat-label>{{ datos.etiqueta }}</mat-label>
            <textarea matInput [(ngModel)]="texto" rows="3" maxlength="1000"></textarea>
            <mat-hint>{{ texto.trim().length < minimo ? 'Mínimo ' + minimo + ' caracteres' : '' }}</mat-hint>
          </mat-form-field>
        }
        @if (datos.fecha; as f) {
          <mat-form-field style="width: 100%; margin-top: 8px">
            <mat-label>{{ f.etiqueta }}</mat-label>
            <input matInput type="date" [(ngModel)]="fecha" [min]="f.min ?? ''" [max]="f.max ?? ''" />
          </mat-form-field>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      @if (datos.decision; as d) {
        <button mat-stroked-button color="warn" [disabled]="!valido()" (click)="cerrar(false)">{{ d.rechazar }}</button>
        <button mat-flat-button color="primary" [disabled]="!valido()" (click)="cerrar(true)">{{ d.aprobar }}</button>
      } @else {
        <button mat-flat-button color="primary" [disabled]="!valido()" (click)="cerrar()">{{ datos.aceptar ?? 'Confirmar' }}</button>
      }
    </mat-dialog-actions>
  `,
})
export class TextoDialogo {
  readonly datos = inject<DatosTexto>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<TextoDialogo>);
  readonly minimo = this.datos.minimo ?? (this.datos.opciones ? 1 : 10);
  texto = '';
  fecha = this.datos.fecha?.valor ?? '';

  valido(): boolean {
    return this.texto.trim().length >= this.minimo && (!this.datos.fecha || !!this.fecha);
  }

  cerrar(aprobar?: boolean): void {
    const respuesta: RespuestaTexto = { texto: this.texto.trim(), fecha: this.fecha || undefined, aprobar };
    this.ref.close(respuesta);
  }
}

// ------------------------------------------------------------------ Periodos recientes

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** El mes en curso y los anteriores, con la fecha de referencia del servidor. */
export function mesesRecientes(hoy: string, cantidad = 6): { clave: string; anio: number; mes: number; nombre: string; enCurso: boolean }[] {
  const [anio, mes] = hoy.split('-').map(Number);
  return Array.from({ length: cantidad }, (_, i) => {
    const indice = anio * 12 + (mes - 1) - i;
    const a = Math.floor(indice / 12);
    const m = (indice % 12) + 1;
    return { clave: `${a}-${m}`, anio: a, mes: m, nombre: `${MESES_LARGOS[m - 1]} de ${a}`, enCurso: i === 0 };
  });
}
