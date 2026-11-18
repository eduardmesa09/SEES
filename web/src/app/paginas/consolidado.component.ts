import { Component, Input } from '@angular/core';
import { MATERIAL, MedidorComponent } from '../core/compartido';
import { CifrasReporte, CoberturaInformacion, GrupoReporte } from '../core/modelos';

/**
 * Cifras consolidadas del programa (CU-12, CU-13). Junto a cada cifra va la cobertura de
 * información que la respalda: una cifra sin ese dato puede leerse como completa cuando no lo es.
 */
@Component({
  selector: 'app-consolidado',
  standalone: true,
  imports: [MedidorComponent, ...MATERIAL],
  template: `
    @if (conIndicadores) {
    <div class="indicadores">
      <div class="indicador">
        <div class="indicador__etiqueta">Estrategias activas</div>
        <div class="indicador__valor">{{ cifras.estrategiasActivas }}</div>
        <div class="indicador__nota">{{ cifras.estudiantesVinculados }} estudiantes vinculados</div>
      </div>
      <div class="indicador">
        <div class="indicador__etiqueta">Docentes acompañados</div>
        <div class="indicador__valor">{{ cifras.docentesAcompanados }} <small>de {{ cifras.docentesAsignados }}</small></div>
        <div class="indicador__nota">{{ cifras.acompanamientosIndividuales }} individuales · {{ cifras.sesionesGrupales }} sesiones grupales</div>
      </div>
      <div class="indicador">
        <div class="indicador__etiqueta">Cobertura del seguimiento semanal</div>
        <div class="indicador__valor">{{ cifras.coberturaSemanalPct }} <small>%</small></div>
        <div class="indicador__nota">{{ cifras.semanasReportadas }} de {{ cifras.semanasEsperadas }} semanas</div>
      </div>
      <div class="indicador">
        <div class="indicador__etiqueta">Cobertura de información</div>
        <div class="indicador__valor">{{ cobertura.porcentaje }} <small>%</small></div>
        <div class="indicador__nota">
          {{ cobertura.estrategiasCerradas }} de {{ cobertura.estrategiasDelAlcance }} estrategias con periodo cerrado
          @if (cobertura.estrategiasExcluidas) { · {{ cobertura.estrategiasExcluidas }} excluida(s) }
        </div>
      </div>
    </div>
    }

    @if (grupos.length) {
      <section class="tarjeta tarjeta--plana">
        <div class="tarjeta__cabecera"><h2 class="tarjeta__titulo">{{ tituloGrupos }}</h2></div>
        <table class="tabla tabla--compacta">
          <thead>
            <tr>
              <th>{{ columnaGrupo }}</th><th class="centro">Estrategias</th><th class="centro">Estudiantes</th><th>Docentes acompañados</th>
              <th class="centro">Individuales</th><th class="centro">Grupales</th><th class="centro">Seguimiento</th><th class="centro">Con periodo cerrado</th>
            </tr>
          </thead>
          <tbody>
            @for (g of grupos; track g.nombre) {
              <tr>
                <td><strong>{{ g.nombre }}</strong>@if (columnaGrupo === 'Entidad') {<small>{{ g.territorio }}</small>}</td>
                <td class="centro mono">{{ g.estrategias }}</td>
                <td class="centro mono">{{ g.estudiantesVinculados }}</td>
                <td><app-medidor [valor]="g.docentesAcompanados" [total]="g.docentesAsignados" /></td>
                <td class="centro mono">{{ g.acompanamientosIndividuales }}</td>
                <td class="centro mono">{{ g.sesionesGrupales }}</td>
                <td class="centro mono">{{ g.coberturaSemanalPct }} %</td>
                <td class="centro mono">{{ g.coberturaInformacionPct }} %</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    }
  `,
})
export class ConsolidadoComponent {
  @Input({ required: true }) cifras!: CifrasReporte;
  @Input({ required: true }) cobertura!: CoberturaInformacion;
  @Input() grupos: GrupoReporte[] = [];
  @Input() tituloGrupos = 'Por territorio';
  @Input() columnaGrupo = 'Territorio';
  @Input() conIndicadores = true;
}
