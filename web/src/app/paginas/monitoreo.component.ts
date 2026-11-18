import { DatePipe } from '@angular/common';
import { Component, Input, OnDestroy, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ChipComponent, DatosTexto, MATERIAL, RespuestaTexto, TextoDialogo, Tono, mensajeDe } from '../core/compartido';
import { DetalleSesion, EstadoOperacion, SesionPilotaje } from '../core/modelos';

/** Serie de un solo indicador por minuto. Una serie: el título la nombra, sin leyenda. */
@Component({
  selector: 'app-serie',
  standalone: true,
  template: `
    <svg class="serie" [attr.viewBox]="'0 0 ' + ancho + ' ' + alto" role="img" [attr.aria-label]="titulo">
      @for (g of guias; track g.y) {
        <line x1="34" [attr.x2]="ancho" [attr.y1]="g.y" [attr.y2]="g.y" class="serie__guia" />
        <text x="28" [attr.y]="g.y + 3" text-anchor="end" class="serie__texto">{{ g.valor }}</text>
      }
      @if (umbral !== null && yUmbral !== null) {
        <line x1="34" [attr.x2]="ancho" [attr.y1]="yUmbral" [attr.y2]="yUmbral" class="serie__umbral" />
        <text [attr.x]="ancho" [attr.y]="yUmbral < 14 ? yUmbral + 12 : yUmbral - 4" text-anchor="end" class="serie__texto">umbral {{ umbral }} {{ unidad }}</text>
      }
      @for (b of barras; track $index) {
        <g>
          <title>{{ b.etiqueta }}</title>
          <rect [attr.x]="b.x - 6" y="0" width="12" [attr.height]="alto - 16" fill="transparent" />
          @if (b.alto > 0) {<rect [attr.x]="b.x - 3.5" [attr.y]="b.y" width="7" [attr.height]="b.alto" rx="2" class="serie__barra" [class.serie__barra--alta]="umbral !== null && b.valor > umbral" />}
        </g>
      }
      <line x1="34" [attr.x2]="ancho" [attr.y1]="alto - 16" [attr.y2]="alto - 16" class="serie__eje" />
      <text x="34" [attr.y]="alto - 3" class="serie__texto">hace 30 min</text>
      <text [attr.x]="ancho" [attr.y]="alto - 3" text-anchor="end" class="serie__texto">ahora</text>
    </svg>
  `,
})
export class SerieComponent {
  readonly ancho = 520;
  readonly alto = 130;
  @Input() titulo = '';
  @Input() unidad = '';
  @Input() umbral: number | null = null;
  barras: { x: number; y: number; alto: number; valor: number; etiqueta: string }[] = [];
  guias: { y: number; valor: number }[] = [];
  yUmbral: number | null = null;

  @Input({ required: true }) set puntos(valor: { minuto: string; valor: number }[]) {
    const util = this.alto - 26;
    const maximo = Math.max(1, ...valor.map((p) => p.valor), this.umbral ?? 0);
    const tope = Math.ceil(maximo / 5) * 5 || 5;
    const escala = (v: number) => (v / tope) * util;
    const paso = (this.ancho - 44) / Math.max(1, valor.length);
    this.barras = valor.map((p, i) => {
      const h = escala(p.valor);
      const hora = new Date(p.minuto).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      return { x: 40 + i * paso + paso / 2, y: this.alto - 16 - h, alto: h, valor: p.valor, etiqueta: `${hora}: ${p.valor} ${this.unidad}` };
    });
    this.guias = [0.5, 1].map((f) => ({ y: this.alto - 16 - util * f, valor: Math.round(tope * f) }));
    this.yUmbral = this.umbral !== null ? this.alto - 16 - escala(this.umbral) : null;
  }
}

/** CU-15: registro de un incidente reportado por un tutor durante la sesión. */
@Component({
  selector: 'app-incidente-dialogo',
  standalone: true,
  imports: [ReactiveFormsModule, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>Registrar incidente</h2>
    <mat-dialog-content>
      <form class="formulario" [formGroup]="formulario" style="margin-top: 8px">
        <mat-form-field>
          <mat-label>Usuario afectado</mat-label>
          <input matInput formControlName="usuarioAfectado" [attr.list]="'conectados'" />
          <datalist id="conectados">@for (u of datos.conectados; track u.correo) {<option [value]="u.correo"></option>}</datalist>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Región desde la que accedía</mat-label>
          <mat-select formControlName="region">
            @for (r of regiones; track r) {<mat-option [value]="r">{{ r }}</mat-option>}
          </mat-select>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>¿Qué ocurrió?</mat-label>
          <textarea matInput formControlName="descripcion" rows="2"></textarea>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Acción tomada</mat-label>
          <textarea matInput formControlName="accion" rows="2"></textarea>
        </mat-form-field>
        <mat-slide-toggle class="ancho" formControlName="completoRegistro">El tutor pudo completar su registro misional</mat-slide-toggle>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()">Registrar</button>
    </mat-dialog-actions>
  `,
})
export class IncidenteDialogo {
  readonly datos = inject<{ conectados: { correo: string; region: string }[] }>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<IncidenteDialogo>);
  readonly regiones = ['Andina', 'Caribe', 'Pacífica', 'Orinoquía', 'Amazonía', 'Insular', 'Nacional'];
  readonly formulario = inject(FormBuilder).nonNullable.group({
    usuarioAfectado: ['', [Validators.required, Validators.minLength(3)]],
    region: ['Andina', Validators.required],
    descripcion: ['', [Validators.required, Validators.minLength(5)]],
    accion: ['', [Validators.required, Validators.minLength(5)]],
    completoRegistro: [true],
  });

  constructor() {
    this.formulario.controls.usuarioAfectado.valueChanges.subscribe((correo) => {
      const conectado = this.datos.conectados.find((u) => u.correo === correo);
      const region = conectado?.region.split(' y ')[0];
      if (region && this.regiones.includes(region)) this.formulario.controls.region.setValue(region);
    });
  }

  guardar(): void {
    this.formulario.markAllAsTouched();
    if (this.formulario.valid) this.ref.close(this.formulario.getRawValue());
  }
}

const ESTADO_SESION: Record<SesionPilotaje['estado'], { etiqueta: string; tono: Tono; icono: string }> = {
  PROGRAMADA: { etiqueta: 'Programada', tono: 'neutro', icono: 'event' },
  RETRASADA: { etiqueta: 'Retrasada', tono: 'aviso', icono: 'schedule' },
  INICIADA: { etiqueta: 'En curso', tono: 'info', icono: 'play_circle' },
  FINALIZADA: { etiqueta: 'Finalizada', tono: 'bien', icono: 'check_circle' },
  SUSPENDIDA: { etiqueta: 'Suspendida', tono: 'critico', icono: 'pause_circle' },
};

/**
 * CU-15 / RQ_016: consola del ingeniero de soporte durante las sesiones programadas con los tutores.
 * No registra información misional: garantiza que la sesión pueda desarrollarse y recoge la evidencia técnica.
 */
@Component({
  selector: 'app-monitoreo',
  standalone: true,
  imports: [DatePipe, ChipComponent, SerieComponent, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Monitoreo del pilotaje</h1>
        <p class="pagina__sub">Estado de los servicios, usuarios conectados, tiempos de respuesta y errores en tiempo real. Se actualiza cada 10 segundos.</p>
      </div>
    </header>

    @if (estado(); as e) {
      @if (e.alerta) {
        <div class="aviso aviso--critico"><mat-icon>notification_important</mat-icon><div><strong>Alerta de desempeño</strong><p>{{ e.alerta }}</p></div></div>
      }
      <div class="servicios">
        @for (s of e.servicios; track s.nombre) {
          <div class="servicio">
            <app-chip [tono]="s.disponible ? 'bien' : 'critico'" [icono]="s.disponible ? 'check_circle' : 'error'">{{ s.disponible ? 'Disponible' : 'No disponible' }}</app-chip>
            <strong>{{ s.nombre }}</strong>
            <small>{{ s.detalle }}</small>
          </div>
        }
      </div>

      <div class="indicadores">
        <div class="indicador">
          <div class="indicador__etiqueta">Usuarios conectados</div>
          <div class="indicador__valor">{{ e.conectados.total }}</div>
          <div class="indicador__nota">con actividad en los últimos 5 minutos</div>
        </div>
        <div class="indicador">
          <div class="indicador__etiqueta">Tiempo de respuesta (p95)</div>
          <div class="indicador__valor">{{ e.ultimos15Minutos.p95 }} <small>ms</small></div>
          <div class="indicador__nota">mediana {{ e.ultimos15Minutos.p50 }} ms · umbral {{ e.umbralP95Ms }} ms</div>
        </div>
        <div class="indicador">
          <div class="indicador__etiqueta">Peticiones (15 min)</div>
          <div class="indicador__valor">{{ e.ultimos15Minutos.peticiones }}</div>
          <div class="indicador__nota">concurrencia máxima {{ e.ultimos15Minutos.concurrenciaMaxima }} usuario(s)</div>
        </div>
        <div class="indicador">
          <div class="indicador__etiqueta">Errores (15 min)</div>
          <div class="indicador__valor">{{ e.ultimos15Minutos.errores }}</div>
          <div class="indicador__nota">{{ e.ultimos15Minutos.rechazos }} rechazo(s) de validación o permisos</div>
        </div>
      </div>

      <div class="dos-columnas">
        <section class="tarjeta">
          <h2 class="tarjeta__titulo">Peticiones por minuto</h2>
          <app-serie titulo="Peticiones por minuto en los últimos 30 minutos" unidad="peticiones" [puntos]="serie('peticiones')" />
        </section>
        <section class="tarjeta" style="margin-top: 0">
          <h2 class="tarjeta__titulo">Tiempo de respuesta, percentil 95</h2>
          <app-serie titulo="Percentil 95 del tiempo de respuesta por minuto" unidad="ms" [umbral]="e.umbralP95Ms" [puntos]="serie('p95')" />
        </section>
      </div>

      <div class="dos-columnas" style="margin-top: 18px">
        <section class="tarjeta tarjeta--plana">
          <div class="tarjeta__cabecera"><h2 class="tarjeta__titulo">Accesos por región</h2></div>
          @if (!e.conectados.usuarios.length) {
            <div class="vacio" style="padding: 24px"><strong>Nadie conectado en este momento</strong></div>
          } @else {
            <table class="tabla tabla--compacta">
              <thead><tr><th>Usuario</th><th>Región</th><th class="centro">Peticiones</th><th>Última actividad</th></tr></thead>
              <tbody>
                @for (u of e.conectados.usuarios; track u.correo) {
                  <tr><td>{{ u.correo }}</td><td>{{ u.region }}</td><td class="centro mono">{{ u.peticiones }}</td><td class="nowrap">{{ u.ultima | date: 'h:mm:ss a' }}</td></tr>
                }
              </tbody>
            </table>
          }
        </section>
        <section class="tarjeta tarjeta--plana" style="margin-top: 0">
          <div class="tarjeta__cabecera"><h2 class="tarjeta__titulo">Errores y rechazos repetidos</h2></div>
          @if (!e.ultimos15Minutos.erroresRepetidos.length) {
            <div class="vacio" style="padding: 24px"><strong>Sin errores en los últimos 15 minutos</strong></div>
          } @else {
            <table class="tabla tabla--compacta">
              <thead><tr><th>Código</th><th>Operación</th><th class="centro">Veces</th></tr></thead>
              <tbody>
                @for (x of e.ultimos15Minutos.erroresRepetidos; track x.metodo + x.ruta + x.estado) {
                  <tr><td><app-chip [tono]="x.estado >= 500 ? 'critico' : 'aviso'" icono="error_outline">{{ x.estado }}</app-chip></td><td class="codigo">{{ x.metodo }} {{ x.ruta }}</td><td class="centro mono">{{ x.veces }}</td></tr>
                }
              </tbody>
            </table>
          }
        </section>
      </div>
    } @else {
      <div class="cargando">Consultando el estado de los servicios…</div>
    }

    <section class="tarjeta tarjeta--plana" style="margin-top: 18px">
      <div class="tarjeta__cabecera">
        <div><h2 class="tarjeta__titulo">Sesiones programadas con los tutores</h2><p class="secundario">Verificación previa, incidentes atendidos y reporte de comportamiento técnico de cada sesión.</p></div>
        <button mat-flat-button color="primary" (click)="programar()"><mat-icon>add</mat-icon> Programar sesión</button>
      </div>
      @if (!sesiones().length) {
        <div class="vacio"><mat-icon>event</mat-icon><strong>No hay sesiones programadas</strong></div>
      } @else {
        <table class="tabla tabla--clic">
          <thead><tr><th>Sesión</th><th>Estado</th><th>Inicio</th><th>Fin</th><th class="centro">Incidentes</th></tr></thead>
          <tbody>
            @for (s of sesiones(); track s.id) {
              <tr (click)="abrir(s.id)" [class.fila--elegida]="detalle()?.id === s.id">
                <td><strong>{{ s.nombre }}</strong><small>Programada por {{ s.creadaPor }}</small></td>
                <td><app-chip [tono]="estadoSesion[s.estado].tono" [icono]="estadoSesion[s.estado].icono">{{ estadoSesion[s.estado].etiqueta }}</app-chip></td>
                <td class="nowrap">{{ s.iniciadaEn ? (s.iniciadaEn | date: 'd MMM, h:mm a') : '—' }}</td>
                <td class="nowrap">{{ s.finalizadaEn ? (s.finalizadaEn | date: 'd MMM, h:mm a') : '—' }}</td>
                <td class="centro mono">{{ s.incidentes }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    @if (detalle(); as d) {
      <section class="tarjeta" style="margin-top: 18px">
        <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-start">
          <div>
            <h2 class="tarjeta__titulo">{{ d.nombre }}</h2>
            <app-chip [tono]="estadoSesion[d.estado].tono" [icono]="estadoSesion[d.estado].icono">{{ estadoSesion[d.estado].etiqueta }}</app-chip>
            @if (d.causaRetraso) {<p class="secundario" style="margin-top: 6px">Retraso: {{ d.causaRetraso }}</p>}
            @if (d.causaCierre) {<p class="secundario" style="margin-top: 6px">Causa de la suspensión: {{ d.causaCierre }}</p>}
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            @if (d.estado === 'PROGRAMADA' || d.estado === 'RETRASADA') {
              <button mat-stroked-button (click)="accion(d.id, 'verificacion')"><mat-icon>fact_check</mat-icon> Verificar servicios</button>
              <button mat-stroked-button (click)="retrasar(d.id)"><mat-icon>schedule</mat-icon> Registrar retraso</button>
              <button mat-flat-button color="primary" (click)="accion(d.id, 'inicio')"><mat-icon>play_arrow</mat-icon> Iniciar sesión</button>
            }
            @if (d.estado === 'INICIADA') {
              <button mat-stroked-button (click)="incidente(d.id)"><mat-icon>report</mat-icon> Registrar incidente</button>
              <button mat-stroked-button color="warn" (click)="suspender(d.id)"><mat-icon>pause</mat-icon> Suspender</button>
              <button mat-flat-button color="primary" (click)="accion(d.id, 'cierre')"><mat-icon>stop</mat-icon> Finalizar y generar reporte</button>
            }
          </div>
        </div>

        @if (d.verificacion; as v) {
          <div class="aviso aviso--{{ v.todosDisponibles ? 'bien' : 'critico' }}" style="margin: 14px 0 0">
            <mat-icon>{{ v.todosDisponibles ? 'verified' : 'error' }}</mat-icon>
            <div>
              <strong>Verificación previa {{ v.todosDisponibles ? 'satisfactoria' : 'con servicios caídos' }} · {{ d.verificadaEn | date: 'h:mm:ss a' }}</strong>
              <p>@for (s of v.servicios; track s.nombre) { {{ s.nombre }}: {{ s.disponible ? 'disponible' : 'no disponible' }}{{ $last ? '.' : ' · ' }} }</p>
            </div>
          </div>
        } @else if (d.estado === 'PROGRAMADA') {
          <p class="tenue" style="margin-top: 12px">Antes de iniciar debe registrar la verificación previa de los servicios.</p>
        }

        @if (d.operacion; as o) {
          <div class="resumen-cierre">
            <div><span>Concurrencia máxima</span><strong>{{ o.concurrenciaMaxima }} usuario(s)</strong></div>
            <div><span>Peticiones atendidas</span><strong>{{ o.peticiones }}</strong></div>
            <div><span>Tiempo de respuesta p95</span><strong>{{ o.p95 }} ms</strong></div>
            <div><span>Errores del servidor</span><strong>{{ o.errores }}</strong></div>
          </div>
        }
        @if (d.reporte; as rep) {
          <div class="aviso aviso--info" style="margin: 14px 0 0">
            <mat-icon>summarize</mat-icon>
            <div>
              <strong>Reporte de comportamiento técnico</strong>
              <p>
                {{ rep.incidentes.total }} incidente(s), {{ rep.incidentes.resueltos }} resuelto(s){{ rep.incidentes.promedioSolucionMin !== null ? ' en ' + rep.incidentes.promedioSolucionMin + ' min en promedio' : '' }},
                {{ rep.incidentes.criticos }} crítico(s) y {{ rep.incidentes.sinCompletarRegistro }} tutor(es) sin completar su registro.
                Tiempo de respuesta p95 de {{ rep.operacion.p95 }} ms frente al umbral de {{ rep.umbralP95Ms }} ms.
              </p>
            </div>
          </div>
        }

        @if (d.incidentes.length) {
          <table class="tabla tabla--compacta" style="margin-top: 14px">
            <thead><tr><th>Hora</th><th>Usuario y región</th><th>Qué ocurrió y acción tomada</th><th>Registro misional</th><th>Solución</th></tr></thead>
            <tbody>
              @for (i of d.incidentes; track i.id) {
                <tr>
                  <td class="nowrap">{{ i.ocurridoEn | date: 'h:mm a' }}</td>
                  <td>{{ i.usuarioAfectado }}<small>{{ i.region }}</small></td>
                  <td>{{ i.descripcion }}<small>{{ i.accion }}</small></td>
                  <td>@if (i.completoRegistro) {<app-chip tono="bien" icono="check_circle">Completó</app-chip>} @else {<app-chip tono="critico" icono="cancel">No completó</app-chip>}</td>
                  <td class="nowrap">
                    @if (i.resueltoEn) {
                      <app-chip [tono]="i.critico ? 'critico' : 'bien'" [icono]="i.critico ? 'priority_high' : 'done'">{{ i.minutosSolucion }} min{{ i.critico ? ' · crítico' : '' }}</app-chip>
                    } @else {
                      @if (i.critico) {<app-chip tono="critico" icono="priority_high">Escalado</app-chip>}
                      @if (d.estado === 'INICIADA') {<button mat-button (click)="resolver(d.id, i.id)">Marcar resuelto</button>}
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }
  `,
})
export class MonitoreoComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly estadoSesion = ESTADO_SESION;
  readonly estado = signal<EstadoOperacion | null>(null);
  readonly sesiones = signal<SesionPilotaje[]>([]);
  readonly detalle = signal<DetalleSesion | null>(null);
  private readonly temporizador = setInterval(() => this.refrescar(), 10_000);

  constructor() {
    this.refrescar();
  }

  ngOnDestroy(): void {
    clearInterval(this.temporizador);
  }

  private refrescar(): void {
    this.api.estadoOperacion().subscribe({ next: (e) => this.estado.set(e), error: () => undefined });
    this.api.sesiones().subscribe({
      next: (s) => {
        this.sesiones.set(s);
        const abierta = this.detalle()?.id ?? s.find((x) => x.estado === 'INICIADA')?.id;
        if (abierta) this.abrir(abierta);
      },
      error: () => undefined,
    });
  }

  serie(campo: 'peticiones' | 'p95') {
    return (this.estado()?.serie ?? []).map((p) => ({ minuto: p.minuto, valor: p[campo] }));
  }

  abrir(id: number): void {
    this.api.sesion(id).subscribe({ next: (d) => this.detalle.set(d), error: () => undefined });
  }

  private ejecutar(peticion: Observable<unknown>, mensaje: string, id: number): void {
    peticion.subscribe({
      next: () => { this.avisos.open(mensaje, 'Cerrar'); this.refrescar(); this.abrir(id); },
      error: (e) => { this.avisos.open(mensajeDe(e), 'Cerrar'); this.abrir(id); },
    });
  }

  programar(): void {
    const datos: DatosTexto = { titulo: 'Programar sesión del pilotaje', etiqueta: 'Nombre de la sesión (región, grupo de tutores, fecha)', minimo: 5, aceptar: 'Programar' };
    this.dialogo.open(TextoDialogo, { data: datos, width: '520px' }).afterClosed().subscribe((r?: RespuestaTexto) => {
      if (!r) return;
      this.api.programarSesion(r.texto).subscribe({ next: (s) => { this.refrescar(); this.abrir(s.id); }, error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar') });
    });
  }

  accion(id: number, accion: 'verificacion' | 'inicio' | 'cierre'): void {
    const mensajes = { verificacion: 'Verificación previa registrada.', inicio: 'Sesión iniciada.', cierre: 'Sesión finalizada: reporte técnico generado.' };
    this.ejecutar(this.api.accionSesion(id, accion), mensajes[accion], id);
  }

  retrasar(id: number): void {
    const datos: DatosTexto = { titulo: 'Registrar retraso de la sesión', mensaje: 'Se alerta al Líder Técnico y se deja constancia de la causa.', etiqueta: 'Causa del retraso', minimo: 5, aceptar: 'Registrar retraso' };
    this.dialogo.open(TextoDialogo, { data: datos, width: '520px' }).afterClosed().subscribe((r?: RespuestaTexto) => {
      if (r) this.ejecutar(this.api.accionSesion(id, 'retraso', { causa: r.texto }), 'Retraso registrado.', id);
    });
  }

  suspender(id: number): void {
    const datos: DatosTexto = {
      titulo: 'Suspender la sesión', mensaje: 'La información parcial se conserva: una sesión interrumpida también es evidencia del comportamiento del sistema.',
      etiqueta: 'Causa y punto en que quedó la sesión', minimo: 5, aceptar: 'Suspender',
    };
    this.dialogo.open(TextoDialogo, { data: datos, width: '520px' }).afterClosed().subscribe((r?: RespuestaTexto) => {
      if (r) this.ejecutar(this.api.accionSesion(id, 'cierre', { suspendida: true, causa: r.texto }), 'Sesión suspendida.', id);
    });
  }

  incidente(id: number): void {
    const conectados = this.estado()?.conectados.usuarios ?? [];
    this.dialogo.open(IncidenteDialogo, { data: { conectados }, width: '620px' }).afterClosed().subscribe((datos) => {
      if (datos) this.ejecutar(this.api.registrarIncidente(id, datos), 'Incidente registrado.', id);
    });
  }

  resolver(id: number, incidenteId: number): void {
    this.ejecutar(this.api.resolverIncidente(id, incidenteId), 'Incidente resuelto.', id);
  }
}
