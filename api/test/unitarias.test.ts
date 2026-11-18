/**
 * Pruebas unitarias (PU) de la matriz 2.9.4: lógica pura, sin base de datos.
 */
import { describe, expect, it } from 'vitest';
import { calcularCobertura } from '../src/domain/cobertura';
import { evaluarAcompanamiento, evaluarSeguimiento, patronDeRegistro } from '../src/domain/oportunidad';
import { normalizar, validarCupo, validarRangoDeFechas } from '../src/domain/reglas';
import { semanaIsoDe, semanasDelMes } from '../src/domain/semanas';
import { mesesDeEstrategia, semanasEsperadas, semanasExigibles } from '../src/modules/periodos/periodos.servicio';

describe('PU-02 · Cálculo de semanas del periodo (RQ_009)', () => {
  it('febrero de 2026 tiene cuatro semanas y marzo de 2026 tiene cinco', () => {
    expect(semanasDelMes(2026, 2)).toHaveLength(4);
    expect(semanasDelMes(2026, 3)).toHaveLength(5);
  });

  it('octubre de 2026 tiene cuatro semanas (41 a 44) y noviembre cinco (45 a 49)', () => {
    expect(semanasDelMes(2026, 10).map((s) => s.semanaIso)).toEqual([41, 42, 43, 44]);
    expect(semanasDelMes(2026, 11).map((s) => s.semanaIso)).toEqual([45, 46, 47, 48, 49]);
  });

  it('cada semana va de lunes a domingo y pertenece a un único mes', () => {
    const octubre = semanasDelMes(2026, 10);
    expect(octubre[0]).toMatchObject({ inicio: '2026-10-05', fin: '2026-10-11' });
    const todas = [...semanasDelMes(2026, 9), ...octubre, ...semanasDelMes(2026, 11)].map((s) => s.inicio);
    expect(new Set(todas).size).toBe(todas.length);
  });

  it('numera las semanas según ISO 8601, incluido el cambio de año', () => {
    expect(semanaIsoDe('2026-11-16')).toEqual({ anioIso: 2026, semanaIso: 47 });
    expect(semanaIsoDe('2026-01-01')).toEqual({ anioIso: 2026, semanaIso: 1 });
    expect(semanaIsoDe('2027-01-01')).toEqual({ anioIso: 2026, semanaIso: 53 });
    expect(semanaIsoDe('2024-12-30')).toEqual({ anioIso: 2025, semanaIso: 1 });
  });

  it('todo mes resulta de cuatro o de cinco semanas, sin configuración manual', () => {
    for (let anio = 2025; anio <= 2028; anio++) {
      for (let mes = 1; mes <= 12; mes++) {
        expect([4, 5]).toContain(semanasDelMes(anio, mes).length);
      }
    }
  });
});

describe('PU-03 · Validación de rango de fechas (RQ_003)', () => {
  it('rechaza una fecha final anterior a la inicial', () => {
    expect(() => validarRangoDeFechas('2026-03-09', '2026-01-26')).toThrowError(/posterior/);
  });

  it('rechaza una duración nula y acepta un rango válido', () => {
    expect(() => validarRangoDeFechas('2026-03-09', '2026-03-09')).toThrowError();
    expect(() => validarRangoDeFechas('2026-03-09', '2026-06-30')).not.toThrow();
  });

  it('rechaza un cupo en cero o negativo', () => {
    expect(() => validarCupo(0)).toThrowError(/mayor que cero/);
    expect(() => validarCupo(-5)).toThrowError();
    expect(() => validarCupo(25)).not.toThrow();
  });
});

describe('PU-04 · Cálculo de cobertura mensual (RQ_009)', () => {
  it('tres de cinco semanas reportadas equivalen al sesenta por ciento', () => {
    expect(calcularCobertura(3, 5)).toEqual({ reportadas: 3, esperadas: 5, porcentaje: 60 });
  });

  it('cuatro de cuatro es cobertura completa y sin semanas esperadas la cobertura es cero', () => {
    expect(calcularCobertura(4, 4).porcentaje).toBe(100);
    expect(calcularCobertura(0, 0).porcentaje).toBe(0);
  });
});

describe('Oportunidad del registro (RQ_011, distribución temporal)', () => {
  it('un seguimiento es oportuno hasta tres días después de terminar la semana', () => {
    expect(evaluarSeguimiento('2026-10-11', '2026-10-09')).toEqual({ oportuno: true, diasRetraso: 0 });
    expect(evaluarSeguimiento('2026-10-11', '2026-10-14')).toEqual({ oportuno: true, diasRetraso: 3 });
    expect(evaluarSeguimiento('2026-10-11', '2026-10-31')).toEqual({ oportuno: false, diasRetraso: 20 });
  });

  it('un acompañamiento es oportuno hasta cinco días después de realizado', () => {
    expect(evaluarAcompanamiento('2026-10-06', '2026-10-07').oportuno).toBe(true);
    expect(evaluarAcompanamiento('2026-10-06', '2026-10-31').oportuno).toBe(false);
  });

  it('distingue el registro sostenido del concentrado al cierre', () => {
    const semanas = semanasDelMes(2026, 10);
    const sostenido = semanas.map((s) => {
      const fechaRegistro = s.fin.replace(/\d\d$/, (d) => String(Number(d) - 2).padStart(2, '0')); // viernes
      return { fechaRegistro, oportuno: evaluarSeguimiento(s.fin, fechaRegistro).oportuno };
    });
    const alCierre = semanas.map((s) => ({ fechaRegistro: '2026-10-31', oportuno: evaluarSeguimiento(s.fin, '2026-10-31').oportuno }));

    expect(patronDeRegistro(sostenido, '2026-10-31')).toBe('SOSTENIDO');
    expect(patronDeRegistro(alCierre, '2026-10-31')).toBe('CONCENTRADO_AL_CIERRE');
    expect(patronDeRegistro([], '2026-10-31')).toBe('SIN_REGISTROS');
  });

  it('un registro tardío pero repartido en el mes es irregular, no concentrado', () => {
    const irregular = [
      { fechaRegistro: '2026-10-19', oportuno: false },
      { fechaRegistro: '2026-10-09', oportuno: true },
      { fechaRegistro: '2026-10-24', oportuno: false },
    ];
    expect(patronDeRegistro(irregular, '2026-10-31')).toBe('IRREGULAR');
  });
});

describe('Periodos de una estrategia', () => {
  const estrategia = { fechaInicio: '2026-10-01', fechaFin: '2026-12-15' };

  it('los periodos van desde el mes de inicio hasta el mes en curso', () => {
    expect(mesesDeEstrategia(estrategia, '2026-11-16')).toEqual([
      { anio: 2026, mes: 10 },
      { anio: 2026, mes: 11 },
    ]);
    expect(mesesDeEstrategia(estrategia, '2026-09-20')).toEqual([]);
  });

  it('las semanas exigibles son las que ya terminaron; la semana en curso aún no lo es', () => {
    expect(semanasEsperadas(estrategia, 2026, 11)).toHaveLength(5);
    expect(semanasExigibles(estrategia, 2026, 11, '2026-11-16').map((s) => s.semanaIso)).toEqual([45, 46]);
  });
});

describe('Comparación normalizada de nombres (RQ_003)', () => {
  it('ignora tildes, mayúsculas y espacios repetidos', () => {
    expect(normalizar('  Semillero   de  ROBÓTICA ')).toBe(normalizar('semillero de robotica'));
  });
});
