import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';
import { MATERIAL } from './compartido';
import { Estrategia, Periodo } from './modelos';

export interface SeleccionDePeriodo {
  estrategia: Estrategia;
  periodo: Periodo;
}

/** Selección de estrategia y de periodo mensual, común al acompañamiento y al seguimiento semanal. */
@Component({
  selector: 'app-selector-periodo',
  standalone: true,
  imports: [FormsModule, ...MATERIAL],
  template: `
    <div class="filtros">
      <mat-form-field class="filtros__amplio" style="width: 420px">
        <mat-label>Estrategia</mat-label>
        <mat-select [(ngModel)]="estrategiaId" (ngModelChange)="alElegirEstrategia()">
          @for (e of estrategias(); track e.id) {
            <mat-option [value]="e.id">{{ e.nombre }} — {{ e.entidadNombre }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Periodo mensual</mat-label>
        <mat-select [(ngModel)]="clavePeriodo" (ngModelChange)="emitir()" [disabled]="!periodos().length">
          @for (p of periodos(); track p.anio + '-' + p.mes) {
            <mat-option [value]="p.anio + '-' + p.mes">{{ p.nombre }}{{ p.enCurso ? ' (en curso)' : '' }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>
    @if (cargado() && !estrategias().length) {
      <div class="tarjeta vacio"><mat-icon>groups</mat-icon><strong>No hay estrategias en su ámbito</strong>{{ sinEstrategias }}</div>
    } @else if (estrategiaId && cargado() && !periodos().length) {
      <div class="tarjeta vacio"><mat-icon>event_upcoming</mat-icon><strong>La estrategia aún no ha iniciado</strong>Todavía no tiene periodos mensuales sobre los cuales registrar.</div>
    }
  `,
})
export class SelectorPeriodoComponent implements OnInit {
  @Input() sinEstrategias = '';
  /** Mes que se elige por defecto: el anterior (ya completo) o el que está en curso. */
  @Input() preferir: 'anterior' | 'actual' = 'actual';
  @Output() readonly seleccion = new EventEmitter<SeleccionDePeriodo>();

  private readonly api = inject(ApiService);
  readonly estrategias = signal<Estrategia[]>([]);
  readonly periodos = signal<Periodo[]>([]);
  readonly cargado = signal(false);
  estrategiaId: number | null = null;
  clavePeriodo = '';

  ngOnInit(): void {
    this.api.estrategias().subscribe((estrategias) => {
      this.estrategias.set(estrategias);
      this.cargado.set(true);
      if (estrategias.length) {
        this.estrategiaId = estrategias[0].id;
        this.alElegirEstrategia();
      }
    });
  }

  alElegirEstrategia(): void {
    if (!this.estrategiaId) return;
    this.api.periodos(this.estrategiaId).subscribe((periodos) => {
      this.periodos.set(periodos);
      const preferido = this.preferir === 'anterior' ? (periodos.find((p) => !p.enCurso) ?? periodos[0]) : periodos[0];
      this.clavePeriodo = preferido ? `${preferido.anio}-${preferido.mes}` : '';
      this.emitir();
    });
  }

  emitir(): void {
    const estrategia = this.estrategias().find((e) => e.id === this.estrategiaId);
    const periodo = this.periodos().find((p) => `${p.anio}-${p.mes}` === this.clavePeriodo);
    if (estrategia && periodo) this.seleccion.emit({ estrategia, periodo });
  }
}
