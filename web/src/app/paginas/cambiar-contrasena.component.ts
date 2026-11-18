import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { MATERIAL, errorApi, mensajeDe } from '../core/compartido';
import { SesionService } from '../core/sesion.service';

/** CU-01, tercer flujo: con las credenciales de activación, el usuario define su propia contraseña. */
@Component({
  selector: 'app-cambiar-contrasena',
  standalone: true,
  imports: [ReactiveFormsModule, ...MATERIAL],
  template: `
    <div class="login">
      <section class="login__marca">
        <div class="login__sello"><mat-icon>key</mat-icon></div>
        <h1>SSES</h1>
        <p class="login__sub">Antes de continuar, defina una contraseña que solo usted conozca.</p>
        <p class="login__piloto">Ministerio de Educación Nacional · Piloto (MVP)</p>
      </section>

      <section class="login__panel">
        <h2>Defina su contraseña</h2>
        <p class="secundario">{{ sesion.usuario()?.nombre }} · {{ sesion.usuario()?.correo }}</p>

        <form [formGroup]="formulario" (ngSubmit)="guardar()">
          @if (error()) {
            <div class="aviso aviso--critico"><mat-icon>error</mat-icon><p>{{ error() }}</p></div>
          }
          <mat-form-field>
            <mat-label>Contraseña de activación</mat-label>
            <input matInput type="password" formControlName="actual" autocomplete="current-password" />
            <mat-error>{{ errorDe('actual') }}</mat-error>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Nueva contraseña</mat-label>
            <input matInput type="password" formControlName="nueva" autocomplete="new-password" />
            <mat-hint>Al menos 8 caracteres, con mayúscula, minúscula, número y un símbolo.</mat-hint>
            <mat-error>{{ errorDe('nueva') }}</mat-error>
          </mat-form-field>
          <mat-form-field style="margin-top: 10px">
            <mat-label>Confirme la nueva contraseña</mat-label>
            <input matInput type="password" formControlName="confirmacion" autocomplete="new-password" />
            <mat-error>Las contraseñas no coinciden</mat-error>
          </mat-form-field>
          <button mat-flat-button color="primary" class="login__entrar" [disabled]="enviando()">
            {{ enviando() ? 'Guardando…' : 'Guardar y continuar' }}
          </button>
          <button mat-button type="button" style="width: 100%; margin-top: 8px" (click)="salir()">Salir</button>
        </form>
      </section>
    </div>
  `,
})
export class CambiarContrasenaComponent {
  private readonly api = inject(ApiService);
  readonly sesion = inject(SesionService);
  private readonly router = inject(Router);

  readonly formulario = inject(FormBuilder).nonNullable.group({
    actual: ['', Validators.required],
    nueva: ['', Validators.required],
    confirmacion: ['', Validators.required],
  });
  readonly error = signal('');
  readonly enviando = signal(false);

  errorDe(campo: string): string {
    return (this.formulario.get(campo)?.errors?.['servidor'] as string) ?? 'Campo obligatorio';
  }

  guardar(): void {
    const { actual, nueva, confirmacion } = this.formulario.getRawValue();
    if (nueva !== confirmacion) {
      this.formulario.controls.confirmacion.setErrors({ distinta: true });
      this.formulario.controls.confirmacion.markAsTouched();
      return;
    }
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    this.enviando.set(true);
    this.error.set('');
    this.api.cambiarContrasena(actual, nueva).subscribe({
      next: ({ token, usuario }) => {
        this.sesion.iniciar(token, usuario);
        this.router.navigateByUrl(this.sesion.rutaInicial());
      },
      error: (e) => {
        this.enviando.set(false);
        for (const [campo, mensaje] of Object.entries(errorApi(e)?.campos ?? {})) {
          const control = this.formulario.get(campo);
          control?.setErrors({ servidor: mensaje });
          control?.markAsTouched();
        }
        this.error.set(mensajeDe(e));
      },
    });
  }

  salir(): void {
    this.sesion.cerrar();
    this.router.navigateByUrl('/login');
  }
}
