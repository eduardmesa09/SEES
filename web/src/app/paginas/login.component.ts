import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { MATERIAL, mensajeDe } from '../core/compartido';
import { SesionService } from '../core/sesion.service';
import { apiLocal } from '../core/api-navegador';
import { API_EN_NAVEGADOR } from '../core/modo';

/** CU-01: ingreso al Piloto. El perfil y el ámbito los determina el servidor. */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, ...MATERIAL],
  template: `
    <div class="login">
      <section class="login__marca">
        <div class="login__sello"><mat-icon>school</mat-icon></div>
        <h1>SSES</h1>
        <p class="login__sub">Sistema de Seguimiento de Actividades Extracurriculares</p>
        <p class="login__piloto">Ministerio de Educación Nacional · Piloto (MVP)</p>
      </section>

      <section class="login__panel">
        <h2>Ingreso al Piloto</h2>
        <p class="secundario">Use su correo institucional y su contraseña.</p>

        <form [formGroup]="formulario" (ngSubmit)="ingresar()">
          @if (error()) {
            <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
          }
          <mat-form-field>
            <mat-label>Correo institucional</mat-label>
            <input matInput type="email" formControlName="correo" autocomplete="username" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Contraseña</mat-label>
            <input matInput type="password" formControlName="contrasena" autocomplete="current-password" />
          </mat-form-field>
          <button mat-flat-button color="primary" class="login__entrar" [disabled]="enviando()">
            {{ enviando() ? 'Verificando…' : 'Ingresar' }}
          </button>
        </form>

        <div class="login__demo">
          <span>Usuarios de demostración (datos sintéticos)</span>
          <div class="login__usuarios">
            @for (u of usuarios; track u.correo) {
              <button type="button" class="login__usuario" (click)="usar(u.correo)">
                <strong>{{ u.perfil }}</strong>
                <small>{{ u.nombre }} · {{ u.correo }}</small>
              </button>
            }
          </div>
        </div>

        @if (enNavegador) {
          <div class="aviso aviso--info login__navegador">
            <mat-icon>public</mat-icon>
            <div>
              <strong>Versión en línea</strong>
              <p>
                El Piloto corre completo en este navegador y los datos se guardan solo aquí.
                @if (cargadosEl()) { Datos sintéticos cargados el {{ cargadosEl() }}. }
              </p>
              <div class="aviso__acciones">
                <button mat-stroked-button type="button" (click)="reiniciar()" [disabled]="reiniciando()">
                  <mat-icon>restart_alt</mat-icon> {{ reiniciando() ? 'Reiniciando…' : 'Reiniciar datos de la demostración' }}
                </button>
              </div>
            </div>
          </div>
        }
      </section>
    </div>
  `,
})
export class LoginComponent {
  private readonly api = inject(ApiService);
  private readonly sesion = inject(SesionService);
  private readonly router = inject(Router);

  readonly formulario = inject(FormBuilder).nonNullable.group({
    correo: ['', Validators.required],
    contrasena: ['', Validators.required],
  });
  readonly error = signal('');
  readonly enviando = signal(false);

  readonly usuarios = [
    { perfil: 'Tutor', nombre: 'Camila Torres', correo: 'tutor1@sses.test' },
    { perfil: 'Tutor líder', nombre: 'Marta Gómez', correo: 'lider@sses.test' },
    { perfil: 'Tutor', nombre: 'Andrés Mejía', correo: 'tutor2@sses.test' },
    { perfil: 'Tutor', nombre: 'Luisa Castro', correo: 'tutor3@sses.test' },
    { perfil: 'Ente de control', nombre: 'Patricia Rojas', correo: 'control@sses.test' },
    { perfil: 'Administrador', nombre: 'Ricardo Salazar', correo: 'admin@sses.test' },
    { perfil: 'Ingeniero de soporte', nombre: 'Diego Ruiz', correo: 'soporte@sses.test' },
  ];

  readonly enNavegador = API_EN_NAVEGADOR;
  readonly cargadosEl = signal<string | null>(null);
  readonly reiniciando = signal(false);

  constructor() {
    if (this.sesion.usuario()) this.router.navigateByUrl(this.sesion.rutaInicial());
    // La primera visita crea la base en el navegador; se arranca de una vez para que el ingreso sea rápido.
    if (this.enNavegador) apiLocal().then((a) => this.cargadosEl.set(a.datosCargadosEl())).catch(() => undefined);
  }

  /** Versión en línea: vuelve a dejar los datos como recién instalados, igual que reiniciar-datos.cmd. */
  reiniciar(): void {
    if (!confirm('Se borrará todo lo registrado en este navegador y se cargarán de nuevo los datos sintéticos. ¿Continuar?')) return;
    this.reiniciando.set(true);
    apiLocal()
      .then((a) => a.reiniciar().then(() => this.cargadosEl.set(a.datosCargadosEl())))
      .catch(() => this.error.set('No fue posible reiniciar los datos. Recargue la página e intente de nuevo.'))
      .finally(() => this.reiniciando.set(false));
  }

  usar(correo: string): void {
    this.formulario.setValue({ correo, contrasena: 'Sses2026*' });
    this.ingresar();
  }

  ingresar(): void {
    if (this.formulario.invalid) {
      this.error.set('Escriba el correo y la contraseña.');
      return;
    }
    const { correo, contrasena } = this.formulario.getRawValue();
    this.enviando.set(true);
    this.error.set('');
    this.api.login(correo, contrasena).subscribe({
      next: ({ token, usuario }) => {
        this.sesion.iniciar(token, usuario);
        this.router.navigateByUrl(this.sesion.rutaInicial());
      },
      error: (e) => {
        this.enviando.set(false);
        this.error.set(mensajeDe(e));
      },
    });
  }
}
