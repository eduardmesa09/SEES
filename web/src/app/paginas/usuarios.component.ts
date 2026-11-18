import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../core/api.service';
import { ChipComponent, ConfirmarDialogo, DatosConfirmacion, ETIQUETA_PERFIL, MATERIAL, errorApi, mensajeDe } from '../core/compartido';
import { Credenciales, EntidadConCarga, Perfil, Persona, UsuarioAdmin } from '../core/modelos';

const PERFILES: Perfil[] = ['TUTOR', 'TUTOR_LIDER', 'ENTE_CONTROL', 'ADMIN', 'SOPORTE'];
const CON_AMBITO: Perfil[] = ['TUTOR', 'TUTOR_LIDER'];

interface DatosUsuario {
  usuario: UsuarioAdmin | null;
  entidades: EntidadConCarga[];
}

/** Alta o edición: perfil y ámbito sobre el cual puede trabajar. */
@Component({
  selector: 'app-usuario-dialogo',
  standalone: true,
  imports: [ReactiveFormsModule, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>{{ datos.usuario ? 'Editar a ' + datos.usuario.nombre : 'Nuevo usuario' }}</h2>
    <mat-dialog-content>
      @if (datos.usuario) {
        <p class="dialogo__mensaje">Al guardar se cierran sus sesiones abiertas, para que el nuevo perfil o ámbito rija de inmediato.</p>
      } @else {
        <p class="dialogo__mensaje">El sistema genera credenciales de activación: en su primer ingreso la persona debe definir su propia contraseña.</p>
      }
      @if (error()) {
        <div class="aviso aviso--critico" style="margin-top: 12px"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
      }
      <form class="formulario" [formGroup]="formulario" style="margin-top: 14px">
        <mat-form-field>
          <mat-label>Documento</mat-label>
          <input matInput formControlName="documento" />
          <mat-error>{{ errorDe('documento') }}</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Perfil</mat-label>
          <mat-select formControlName="perfil">
            @for (p of perfiles; track p) {<mat-option [value]="p">{{ etiqueta[p] }}</mat-option>}
          </mat-select>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Nombre completo</mat-label>
          <input matInput formControlName="nombre" />
          <mat-error>{{ errorDe('nombre') }}</mat-error>
        </mat-form-field>
        <mat-form-field class="ancho">
          <mat-label>Correo institucional</mat-label>
          <input matInput formControlName="correo" type="email" />
          <mat-error>{{ errorDe('correo') }}</mat-error>
        </mat-form-field>
        @if (conAmbito()) {
          <mat-form-field class="ancho">
            <mat-label>Ámbito: entidades sobre las que trabaja</mat-label>
            <mat-select formControlName="entidadIds" multiple>
              @for (e of datos.entidades; track e.id) {<mat-option [value]="e.id">{{ e.nombre }} · {{ e.territorio }}</mat-option>}
            </mat-select>
            <mat-hint>{{ formulario.controls.perfil.value === 'TUTOR' ? 'El tutor solo alcanza las estrategias que tenga asignadas dentro de estas entidades.' : 'El tutor líder alcanza todas las estrategias de estas entidades.' }}</mat-hint>
            <mat-error>{{ errorDe('entidadIds') }}</mat-error>
          </mat-form-field>
          <div class="ancho" style="display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 6px">
            <span class="tenue" style="font-size: 12.5px; align-self: center">Seleccionar territorio:</span>
            @for (t of territorios; track t) {<button mat-stroked-button type="button" (click)="territorio(t)">{{ t }}</button>}
          </div>
        } @else {
          <p class="ancho tenue" style="font-size: 12.5px">Este perfil no trabaja sobre un ámbito de entidades.</p>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="guardando()">{{ datos.usuario ? 'Guardar cambios' : 'Crear usuario' }}</button>
    </mat-dialog-actions>
  `,
})
export class UsuarioDialogo {
  readonly datos = inject<DatosUsuario>(MAT_DIALOG_DATA);
  private readonly api = inject(ApiService);
  private readonly ref = inject(MatDialogRef<UsuarioDialogo>);
  readonly perfiles = PERFILES;
  readonly etiqueta = ETIQUETA_PERFIL;
  readonly territorios = [...new Set(this.datos.entidades.map((e) => e.territorio))];
  readonly error = signal('');
  readonly guardando = signal(false);
  readonly formulario = inject(FormBuilder).nonNullable.group({
    documento: [this.datos.usuario?.documento ?? '', Validators.required],
    nombre: [this.datos.usuario?.nombre ?? '', Validators.required],
    correo: [this.datos.usuario?.correo ?? '', Validators.required],
    perfil: [(this.datos.usuario?.perfil ?? 'TUTOR') as Perfil, Validators.required],
    entidadIds: [this.datos.usuario?.entidadIds ?? ([] as number[])],
  });

  constructor() {
    if (this.datos.usuario) {
      this.formulario.controls.documento.disable();
      this.formulario.controls.correo.disable();
    }
  }

  conAmbito(): boolean {
    return CON_AMBITO.includes(this.formulario.controls.perfil.value);
  }

  territorio(t: string): void {
    const ids = new Set([...this.formulario.controls.entidadIds.value, ...this.datos.entidades.filter((e) => e.territorio === t).map((e) => e.id)]);
    this.formulario.controls.entidadIds.setValue([...ids]);
  }

  errorDe(campo: string): string {
    return (this.formulario.get(campo)?.errors?.['servidor'] as string) ?? 'Campo obligatorio';
  }

  guardar(): void {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid) return;
    this.guardando.set(true);
    this.error.set('');
    const v = this.formulario.getRawValue();
    const cuerpo = { ...v, entidadIds: this.conAmbito() ? v.entidadIds : [] };
    const peticion = this.datos.usuario
      ? this.api.actualizarUsuario(this.datos.usuario.id, { nombre: cuerpo.nombre, perfil: cuerpo.perfil, entidadIds: cuerpo.entidadIds })
      : this.api.crearUsuario(cuerpo);
    peticion.subscribe({
      next: (r) => this.ref.close(r ?? true),
      error: (e) => {
        this.guardando.set(false);
        for (const [campo, mensaje] of Object.entries(errorApi(e)?.campos ?? {})) {
          const control = this.formulario.get(campo);
          control?.setErrors({ servidor: mensaje });
          control?.markAsTouched();
        }
        this.error.set(mensajeDe(e));
      },
    });
  }
}

interface DatosRevocacion {
  usuario: UsuarioAdmin;
  estrategias: { id: number; codigo: string; nombre: string; entidadNombre: string; candidatos: Persona[] }[];
}

/** CU-14: revocación con motivo; un tutor con estrategias vigentes exige reasignarlas antes. */
@Component({
  selector: 'app-revocar-dialogo',
  standalone: true,
  imports: [FormsModule, ...MATERIAL],
  template: `
    <h2 mat-dialog-title>Revocar el acceso de {{ datos.usuario.nombre }}</h2>
    <mat-dialog-content>
      <p class="dialogo__mensaje">La cuenta queda inactiva y sus sesiones abiertas se cierran de inmediato. Lo que ya registró conserva su autoría.</p>
      @if (datos.estrategias.length) {
        <div class="aviso aviso--aviso" style="margin: 14px 0 6px">
          <mat-icon>warning</mat-icon>
          <div><strong>Tiene {{ datos.estrategias.length }} estrategia(s) vigente(s) a cargo</strong><p>Indique a qué tutor se reasigna cada una, para que ninguna quede sin responsable.</p></div>
        </div>
        @for (e of datos.estrategias; track e.id) {
          <mat-form-field style="width: 100%">
            <mat-label>{{ e.nombre }} ({{ e.codigo }}) · {{ e.entidadNombre }}</mat-label>
            <mat-select [(ngModel)]="reasignaciones[e.id]">
              @for (c of e.candidatos; track c.id) {<mat-option [value]="c.id">{{ c.nombre }}</mat-option>}
            </mat-select>
            @if (!e.candidatos.length) {<mat-hint class="tono--critico">No hay otro tutor habilitado en esa entidad: amplíe primero el ámbito de alguno.</mat-hint>}
          </mat-form-field>
        }
      }
      <mat-form-field style="width: 100%; margin-top: 8px">
        <mat-label>Motivo de la revocación</mat-label>
        <textarea matInput [(ngModel)]="motivo" rows="2"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-flat-button color="warn" [disabled]="!valido()" (click)="confirmar()">Revocar acceso</button>
    </mat-dialog-actions>
  `,
})
export class RevocarDialogo {
  readonly datos = inject<DatosRevocacion>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<RevocarDialogo>);
  motivo = '';
  reasignaciones: Record<number, number> = {};

  valido(): boolean {
    return this.motivo.trim().length >= 5 && this.datos.estrategias.every((e) => this.reasignaciones[e.id]);
  }

  confirmar(): void {
    this.ref.close({
      motivo: this.motivo.trim(),
      reasignaciones: this.datos.estrategias.map((e) => ({ estrategiaId: e.id, tutorId: this.reasignaciones[e.id] })),
    });
  }
}

/** CU-14 / RQ_015: usuarios, perfiles y ámbitos. El administrador no tiene acceso al registro misional. */
@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [DatePipe, ChipComponent, MatMenuModule, ...MATERIAL],
  template: `
    <header class="pagina__encabezado">
      <div>
        <h1 class="pagina__titulo">Usuarios</h1>
        <p class="pagina__sub">Perfil y ámbito de cada usuario del Piloto. Una cuenta se bloquea al quinto intento fallido consecutivo y solo el administrador puede habilitarla.</p>
      </div>
      <div class="pagina__acciones">
        <button mat-flat-button color="primary" (click)="editar(null)"><mat-icon>person_add</mat-icon> Nuevo usuario</button>
      </div>
    </header>

    <section class="tarjeta tarjeta--plana">
      <table class="tabla">
        <thead><tr><th>Usuario</th><th>Perfil</th><th>Ámbito</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          @for (u of usuarios(); track u.id) {
            <tr>
              <td><strong>{{ u.nombre }}</strong><small>{{ u.correo }} · {{ u.documento }}</small></td>
              <td>{{ perfil[u.perfil] }}@if (u.estrategiasACargo) {<small>{{ u.estrategiasACargo }} estrategia(s) vigente(s)</small>}</td>
              <td>
                @if (u.ambito.length) {
                  <span [matTooltip]="u.ambito.join(' · ')">{{ u.ambito.length }} entidad(es)</span>
                } @else {
                  <span class="tenue">{{ u.perfil === 'ENTE_CONTROL' ? 'Todo el país, solo consulta' : 'Sin acceso al registro misional' }}</span>
                }
              </td>
              <td class="nowrap">{{ u.ultimoAcceso ? (u.ultimoAcceso | date: 'd MMM y, h:mm a') : '—' }}</td>
              <td>
                @switch (u.estado) {
                  @case ('ACTIVO') {
                    @if (u.pendienteActivacion) {<app-chip tono="info" icono="key">Pendiente de activación</app-chip>}
                    @else {<app-chip tono="bien" icono="check_circle">Activo</app-chip>}
                  }
                  @case ('BLOQUEADO') {<app-chip tono="critico" icono="lock">Bloqueado</app-chip>}
                  @default {<app-chip tono="neutro" icono="person_off">Revocado</app-chip>@if (u.motivoEstado) {<small>{{ u.motivoEstado }}</small>}}
                }
              </td>
              <td class="derecha nowrap">
                @if (u.estado === 'BLOQUEADO') {
                  <button mat-stroked-button (click)="habilitar(u)"><mat-icon>lock_open</mat-icon> Habilitar</button>
                }
                @if (u.estado === 'INACTIVO') {
                  <button mat-stroked-button (click)="reactivar(u)"><mat-icon>how_to_reg</mat-icon> Reactivar</button>
                } @else {
                  <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="Acciones"><mat-icon>more_vert</mat-icon></button>
                  <mat-menu #menu="matMenu">
                    <button mat-menu-item (click)="editar(u)"><mat-icon>edit</mat-icon> Editar perfil y ámbito</button>
                    <button mat-menu-item (click)="restablecer(u)"><mat-icon>key</mat-icon> Nuevas credenciales de activación</button>
                    <button mat-menu-item (click)="revocar(u)"><mat-icon>person_off</mat-icon> Revocar acceso</button>
                  </mat-menu>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class UsuariosComponent {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(MatSnackBar);
  private readonly dialogo = inject(MatDialog);
  readonly perfil = ETIQUETA_PERFIL;
  readonly usuarios = signal<UsuarioAdmin[]>([]);
  private entidades: EntidadConCarga[] = [];

  constructor() {
    this.cargar();
    this.api.entidadesConCarga().subscribe((e) => (this.entidades = e));
  }

  private cargar(): void {
    this.api.usuarios().subscribe({
      next: (u) => this.usuarios.set(u),
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }

  /** Las credenciales de activación se muestran una sola vez (en el Piloto se envían por correo). */
  private mostrarCredenciales(c: Credenciales, titulo: string): void {
    const datos: DatosConfirmacion = {
      titulo,
      mensaje: 'Entréguelas a la persona por un canal seguro. Se muestran una sola vez; en su primer ingreso deberá definir su propia contraseña.',
      detalles: [`Correo: ${c.correo}`, `Contraseña de activación: ${c.contrasenaTemporal}`],
      aceptar: 'Listo', cancelar: null, icono: 'key', tono: 'info',
    };
    this.dialogo.open(ConfirmarDialogo, { data: datos, width: '520px' });
  }

  editar(usuario: UsuarioAdmin | null): void {
    this.dialogo.open(UsuarioDialogo, { data: { usuario, entidades: this.entidades }, width: '620px', disableClose: true })
      .afterClosed().subscribe((r?: Credenciales | true) => {
        if (!r) return;
        if (r !== true && 'contrasenaTemporal' in r) this.mostrarCredenciales(r, 'Usuario creado');
        else this.avisos.open('Usuario actualizado. Sus sesiones abiertas se cerraron.', 'Cerrar');
        this.cargar();
      });
  }

  restablecer(u: UsuarioAdmin): void {
    this.api.restablecer(u.id).subscribe({
      next: (c) => { this.mostrarCredenciales(c, `Nuevas credenciales para ${u.nombre}`); this.cargar(); },
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }

  reactivar(u: UsuarioAdmin): void {
    this.api.reactivar(u.id).subscribe({
      next: (c) => { this.mostrarCredenciales(c, `${u.nombre} reactivado`); this.cargar(); },
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }

  revocar(u: UsuarioAdmin): void {
    this.api.reasignacion(u.id).subscribe({
      next: (estrategias) => {
        this.dialogo.open(RevocarDialogo, { data: { usuario: u, estrategias: u.perfil === 'TUTOR' ? estrategias : [] }, width: '600px' })
          .afterClosed().subscribe((r?: { motivo: string; reasignaciones: { estrategiaId: number; tutorId: number }[] }) => {
            if (!r) return;
            this.api.revocar(u.id, r.motivo, r.reasignaciones).subscribe({
              next: () => { this.avisos.open(`Acceso de ${u.nombre} revocado. Sus sesiones se cerraron.`, 'Cerrar'); this.cargar(); },
              error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
            });
          });
      },
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }

  habilitar(usuario: UsuarioAdmin): void {
    this.api.desbloquear(usuario.id).subscribe({
      next: () => {
        this.avisos.open(`Cuenta de ${usuario.nombre} habilitada.`, 'Cerrar');
        this.cargar();
      },
      error: (e) => this.avisos.open(mensajeDe(e), 'Cerrar'),
    });
  }
}
