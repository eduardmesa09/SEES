import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import {
  ChipComponent, ConfirmarDialogo, DatosConfirmacion, DatosTexto, ETIQUETA_MODALIDAD, FechaPipe, MATERIAL, MedidorComponent,
  RespuestaTexto, TextoDialogo, errorApi, mensajeDe,
} from '../core/compartido';
import { EstrategiaDetalle, Vinculado } from '../core/modelos';

/** CU-03, flujo alterno: la solicitud queda radicada con su justificación y la estrategia no se altera. */
@Component({
  selector: 'app-solicitud-dialogo',
  standalone: true,
  imports: [ReactiveFormsModule, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>Solicitar modificación</h2>
    <mat-dialog-content>
      <p class="dialogo__mensaje">La solicitud queda radicada para que el tutor líder decida. La estrategia no cambia mientras tanto.</p>
      <form [formGroup]="formulario" style="margin-top: 14px">
        <mat-form-field style="width: 100%; margin-bottom: 10px">
          <mat-label>¿Qué necesita cambiar?</mat-label>
          <input matInput formControlName="cambiosSolicitados" maxlength="1000" />
          <mat-error>Describa el cambio (mínimo 5 caracteres)</mat-error>
        </mat-form-field>
        <mat-form-field style="width: 100%">
          <mat-label>Justificación</mat-label>
          <textarea matInput formControlName="justificacion" rows="3" maxlength="1000"></textarea>
          <mat-error>Escriba la justificación (mínimo 10 caracteres)</mat-error>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" (click)="radicar()">Radicar solicitud</button>
    </mat-dialog-actions>
  `,
})
export class SolicitudDialogo {
  private readonly ref = inject(MatDialogRef<SolicitudDialogo>);
  readonly formulario = inject(FormBuilder).nonNullable.group({
    cambiosSolicitados: ['', [Validators.required, Validators.minLength(5)]],
    justificacion: ['', [Validators.required, Validators.minLength(10)]],
  });

  radicar(): void {
    this.formulario.markAllAsTouched();
    if (this.formulario.valid) this.ref.close(this.formulario.getRawValue());
  }
}

@Component({
  selector: 'app-estrategia-detalle',
  standalone: true,
  imports: [RouterLink, DatePipe, ChipComponent, MedidorComponent, FechaPipe, ...MATERIAL],
  template: `
    <a class="miga" routerLink="/estrategias"><mat-icon>arrow_back</mat-icon> Estrategias</a>

    @if (error()) {
      <div class="aviso aviso--critico"><mat-icon>error</mat-icon><div><strong>No fue posible abrir la estrategia</strong><p>{{ error() }}</p></div></div>
    }

    @if (estrategia(); as e) {
      <header class="pagina__encabezado">
        <div>
          <h1 class="pagina__titulo">{{ e.nombre }}</h1>
          <p class="pagina__sub">
            <span class="codigo">{{ e.codigo }}</span> · {{ e.entidadNombre }} · {{ e.municipio }} ({{ e.territorio }})
          </p>
        </div>
        <div class="pagina__acciones">
          @if (e.permisos.editar) {
            <a mat-stroked-button [routerLink]="['/estrategias', e.id, 'editar']"><mat-icon>edit</mat-icon> Modificar</a>
          }
          @if (e.permisos.vincular) {
            <a mat-flat-button color="primary" [routerLink]="['/estrategias', e.id, 'vincular']"><mat-icon>person_add</mat-icon> Vincular estudiantes</a>
          }
        </div>
      </header>

      @if (e.estado === 'BLOQUEADA' && e.edicionAutorizada) {
        <div class="aviso aviso--bien">
          <mat-icon>lock_open</mat-icon>
          <div>
            <strong>Edición autorizada por el tutor líder</strong>
            <p>{{ e.motivoBloqueo }}</p>
          </div>
        </div>
      } @else if (e.estado === 'BLOQUEADA') {
        <div class="aviso aviso--neutro">
          <mat-icon>lock</mat-icon>
          <div>
            <strong>Estrategia bloqueada para edición</strong>
            <p>{{ e.motivoBloqueo }}</p>
            @if (solicitudEnTramite(e)) {
              <div class="aviso__acciones"><app-chip tono="info" icono="hourglass_top">Solicitud de modificación en trámite ante el tutor líder</app-chip></div>
            }
            @if (e.permisos.solicitarModificacion) {
              <div class="aviso__acciones">
                <button mat-flat-button color="primary" (click)="solicitar(e)"><mat-icon>assignment</mat-icon> Solicitar modificación</button>
                <button mat-stroked-button (click)="probarEdicionDirecta(e)" matTooltip="Envía la modificación directamente al servidor, sin pasar por la pantalla, para comprobar que el bloqueo no depende de la interfaz">
                  <mat-icon>science</mat-icon> Probar edición directa al servidor
                </button>
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="aviso aviso--info">
          <mat-icon>edit</mat-icon>
          <div>
            <strong>Estrategia editable</strong>
            <p>Todavía no tiene estudiantes vinculados. En el momento en que se vincule el primero quedará bloqueada para edición.</p>
          </div>
        </div>
      }

      <section class="tarjeta">
        <dl class="ficha">
          <div class="ancho"><dt>@if (bloqueada()) {<mat-icon>lock</mat-icon>} Objetivo pedagógico</dt><dd>{{ e.objetivo }}</dd></div>
          <div><dt>@if (bloqueada()) {<mat-icon>lock</mat-icon>} Modalidad</dt><dd>{{ etiquetaModalidad[e.modalidad] }}</dd></div>
          <div><dt>@if (bloqueada()) {<mat-icon>lock</mat-icon>} Vigencia</dt><dd>{{ e.fechaInicio | fecha }} a {{ e.fechaFin | fecha }}</dd></div>
          <div>
            <dt>@if (bloqueada()) {<mat-icon>lock</mat-icon>} Estudiantes vinculados / cupo</dt>
            <dd><app-medidor [valor]="e.vinculados" [total]="e.cupoMaximo" /></dd>
          </div>
          <div><dt>Tutores asignados</dt><dd>@for (t of e.tutores; track t.id) {<div>{{ t.nombre }}</div>}</dd></div>
          <div class="ancho" style="grid-column: span 2">
            <dt>Docentes que participan</dt>
            <dd>@for (d of e.docentes; track d.id) {<div>{{ d.nombre }} <span class="tenue">· {{ d.area }}</span></div>}</dd>
          </div>
        </dl>
      </section>

      <section class="tarjeta tarjeta--plana">
        <mat-tab-group animationDuration="0ms">
          <mat-tab [label]="'Estudiantes vinculados (' + e.vinculados + (retirados() ? ' · ' + retirados() + ' retirados' : '') + ')'">
            @if (!vinculados().length) {
              <div class="vacio">
                <mat-icon>person_off</mat-icon>
                <strong>Aún no hay estudiantes vinculados</strong>
                Los estudiantes no se crean: se buscan entre los precargados por el Ministerio y se vinculan.
              </div>
            } @else {
              <table class="tabla tabla--compacta">
                <thead><tr><th>Documento</th><th>Estudiante</th><th>Grado</th><th>Vinculado el</th><th>Vinculado por</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  @for (v of vinculados(); track v.id) {
                    <tr [class.fila--inactiva]="v.estado === 'INACTIVA'">
                      <td class="mono">{{ v.tipoDocumento }} {{ v.documento }}</td>
                      <td>{{ v.apellidos }}, {{ v.nombres }}</td>
                      <td>{{ v.grado }}</td>
                      <td>{{ v.fechaVinculacion | fecha }}</td>
                      <td>{{ v.vinculadoPor }}</td>
                      <td>
                        @if (v.estado === 'ACTIVA') {
                          <app-chip tono="bien" icono="check_circle">Activo</app-chip>
                        } @else {
                          <app-chip tono="neutro" icono="person_remove">Retirado el {{ v.fechaDesvinculacion | fecha: 'corta' }}</app-chip>
                          <small>{{ v.motivoDesvinculacion }}</small>
                        }
                      </td>
                      <td class="derecha">
                        @if (e.permisos.desvincular && v.estado === 'ACTIVA') {
                          <button mat-button (click)="desvincular(e, v)"><mat-icon>person_remove</mat-icon> Desvincular</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </mat-tab>

          <mat-tab [label]="'Historial y solicitudes (' + (e.versiones.length + e.solicitudes.length) + ')'">
            @if (!e.versiones.length && !e.solicitudes.length) {
              <div class="vacio"><mat-icon>history</mat-icon><strong>Sin cambios registrados</strong>Aquí aparecen las versiones anteriores y las solicitudes de modificación.</div>
            }
            @if (e.solicitudes.length) {
              <table class="tabla">
                <thead><tr><th>Solicitud de modificación</th><th>Justificación</th><th>Radicada por</th><th>Fecha</th><th>Estado</th></tr></thead>
                <tbody>
                  @for (s of e.solicitudes; track s.id) {
                    <tr>
                      <td>{{ s.cambiosSolicitados }}</td>
                      <td>{{ s.justificacion }}</td>
                      <td>{{ s.solicitadoPor }}</td>
                      <td class="nowrap">{{ s.creadoEn | date: 'd MMM y, h:mm a' }}</td>
                      <td>
                        @switch (s.estado) {
                          @case ('RADICADA') {<app-chip tono="info" icono="hourglass_top">Radicada</app-chip>}
                          @case ('APROBADA') {<app-chip tono="bien" icono="lock_open">Aprobada</app-chip>}
                          @case ('APLICADA') {<app-chip tono="bien" icono="task_alt">Aprobada y aplicada</app-chip>}
                          @default {<app-chip tono="critico" icono="block">Rechazada</app-chip>}
                        }
                        @if (s.respuesta) {<small>{{ s.resueltoPor }}: {{ s.respuesta }}</small>}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
            @if (e.versiones.length) {
              <table class="tabla">
                <thead><tr><th>Versión anterior</th><th>Datos que tenía</th><th>Modificada por</th><th>Fecha</th></tr></thead>
                <tbody>
                  @for (v of e.versiones; track v.id) {
                    <tr>
                      <td>Versión {{ v.version }}</td>
                      <td>
                        <strong>{{ v.datos['nombre'] }}</strong>
                        <small>Cupo {{ v.datos['cupoMaximo'] }} · {{ $any(v.datos['fechaInicio']) | fecha }} a {{ $any(v.datos['fechaFin']) | fecha }} · {{ etiquetaModalidad[$any(v.datos['modalidad'])] }}</small>
                      </td>
                      <td>{{ v.modificadoPor }}</td>
                      <td class="nowrap">{{ v.modificadoEn | date: 'd MMM y, h:mm a' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </mat-tab>
        </mat-tab-group>
      </section>
    } @else if (!error()) {
      <div class="cargando">Cargando estrategia…</div>
    }
  `,
})
export class EstrategiaDetalleComponent implements OnInit {
  @Input({ required: true }) id!: string;

  private readonly api = inject(ApiService);
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(MatSnackBar);

  readonly etiquetaModalidad = ETIQUETA_MODALIDAD;
  readonly estrategia = signal<EstrategiaDetalle | null>(null);
  readonly vinculados = signal<Vinculado[]>([]);
  readonly error = signal('');

  bloqueada(): boolean {
    return this.estrategia()?.estado === 'BLOQUEADA';
  }

  retirados(): number {
    return this.vinculados().filter((v) => v.estado === 'INACTIVA').length;
  }

  solicitudEnTramite(e: EstrategiaDetalle): boolean {
    return e.solicitudes.some((s) => s.estado === 'RADICADA');
  }

  /** CU-06: el retiro es lógico, con motivo de la lista y fecha; la participación previa se conserva. */
  desvincular(e: EstrategiaDetalle, v: Vinculado): void {
    this.api.listas().subscribe((listas) => {
      const datos: DatosTexto = {
        titulo: `Desvincular a ${v.nombres} ${v.apellidos}`,
        mensaje: 'El estudiante queda inactivo desde la fecha indicada y se libera su cupo. Su participación previa se conserva.',
        etiqueta: 'Motivo del retiro',
        opciones: listas.motivosDesvinculacion,
        fecha: { etiqueta: 'Fecha desde la cual deja de pertenecer', valor: listas.hoy, min: v.fechaVinculacion, max: listas.hoy },
        aceptar: 'Desvincular',
      };
      this.dialogo.open(TextoDialogo, { data: datos, width: '520px' }).afterClosed().subscribe((r?: RespuestaTexto) => {
        if (!r) return;
        this.api.desvincular(e.id, v.id, r.texto, r.fecha!).subscribe({
          next: (res) => {
            this.avisos.open(
              res.desbloqueada
                ? 'Estudiante desvinculado. La estrategia quedó sin participantes activos y vuelve a ser editable.'
                : `Estudiante desvinculado. Quedan ${res.vinculados} vinculado(s).`,
              'Cerrar',
            );
            this.cargar();
          },
          error: (error) => this.avisos.open(mensajeDe(error), 'Cerrar'),
        });
      });
    });
  }

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    const id = Number(this.id);
    this.api.estrategia(id).subscribe({
      next: (e) => this.estrategia.set(e),
      error: (e) => this.error.set(mensajeDe(e)),
    });
    this.api.vinculados(id).subscribe({ next: (v) => this.vinculados.set(v), error: () => undefined });
  }

  solicitar(e: EstrategiaDetalle): void {
    this.dialogo.open(SolicitudDialogo, { width: '540px' }).afterClosed().subscribe((datos) => {
      if (!datos) return;
      this.api.solicitarModificacion(e.id, datos).subscribe({
        next: () => {
          this.avisos.open('Solicitud de modificación radicada. La estrategia no se alteró.', 'Cerrar');
          this.cargar();
        },
        error: (error) => this.avisos.open(mensajeDe(error), 'Cerrar'),
      });
    });
  }

  /**
   * Envía al servidor una modificación real sobre la estrategia bloqueada, como lo haría una
   * petición directa por fuera de la interfaz. Demuestra que la regla la hace cumplir el servidor (RQ_004).
   */
  probarEdicionDirecta(e: EstrategiaDetalle): void {
    const cuerpo = {
      nombre: `${e.nombre} (alterada)`, objetivo: e.objetivo, modalidad: e.modalidad, fechaInicio: e.fechaInicio,
      fechaFin: e.fechaFin, cupoMaximo: e.cupoMaximo + 50, tutorIds: e.tutores.map((t) => t.id),
      docenteIds: e.docentes.map((d) => d.id), version: e.version,
    };
    this.api.modificarEstrategia(e.id, cuerpo).subscribe({
      next: () => {
        this.avisos.open('Atención: el servidor aceptó la modificación.', 'Cerrar');
        this.cargar();
      },
      error: (error: HttpErrorResponse) => {
        const detalle = errorApi(error);
        const datos: DatosConfirmacion = {
          titulo: `El servidor rechazó la edición (HTTP ${error.status})`,
          mensaje: detalle?.mensaje ?? mensajeDe(error),
          detalles: [
            `Petición enviada: PUT /api/estrategias/${e.id} con cupo ${cuerpo.cupoMaximo} y un nombre distinto`,
            `Código de respuesta: ${detalle?.codigo ?? error.status}`,
            'El intento quedó registrado en la auditoría',
            'La estrategia conserva sus datos originales',
          ],
          aceptar: 'Entendido',
          cancelar: null,
          icono: 'gpp_good',
          tono: 'bien',
        };
        this.dialogo.open(ConfirmarDialogo, { data: datos, width: '560px' });
        this.cargar();
      },
    });
  }
}
