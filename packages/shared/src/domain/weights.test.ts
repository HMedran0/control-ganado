import { describe, expect, it } from 'vitest';

import { addDays, toIsoDate, type IsoDate } from '../date.js';
import {
  gainFromMilli,
  gainToMilli,
  isWeightLoss,
  isWeightOutlier,
  last90DaysPoints,
  lastTwoWeights,
  previousWeightFor,
  regressionGainMilli,
  weightAlerts,
  weightGains,
  type WeightAlertSettings,
  type WeightRecordLike,
} from './weights.js';

const d = (value: string): IsoDate => toIsoDate(value);
const HOY = d('2026-09-25');

let sequence = 0;
/** Pesaje de prueba; los ids crecen en el orden en que se crean, como los UUIDv7. */
function w(on: string, kg: number, extra: Partial<WeightRecordLike> = {}): WeightRecordLike {
  sequence += 1;
  return {
    id: `0190a000-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    weighedOn: d(on),
    weightKg: kg,
    isBirthWeight: false,
    voided: false,
    ...extra,
  };
}

const SETTINGS: WeightAlertSettings = {
  weightGainAlertKgPerDay: { YOUNG_MALE: 0.3 },
  weightLossAlertPercent: 5,
  weightGainAnchorMaxDays: 180,
};

describe('regressionGainMilli (ADR-015)', () => {
  it('con dos puntos es la diferencia entre los días', () => {
    expect(
      regressionGainMilli([
        { day: d('2026-06-15'), weightKg: 300 },
        { day: d('2026-09-15'), weightKg: 340 },
      ]),
    ).toBe(435); // 40 kg / 92 días = 0,43478 → 0,435
  });

  it('con varios puntos es la pendiente de mínimos cuadrados', () => {
    // y = 2x + 100 con un punto corrido: pendiente exacta 2,1 kg/día.
    expect(
      regressionGainMilli([
        { day: d('2026-01-01'), weightKg: 100 },
        { day: d('2026-01-11'), weightKg: 121 },
        { day: d('2026-01-21'), weightKg: 142 },
      ]),
    ).toBe(2100);
  });

  it('redondea mitad lejos de cero, también al perder peso', () => {
    // 0,0005 kg/día exactos: 0,05 kg en 100 días.
    expect(
      regressionGainMilli([
        { day: d('2026-01-01'), weightKg: 300 },
        { day: d('2026-04-11'), weightKg: 300.05 },
      ]),
    ).toBe(1);
    expect(
      regressionGainMilli([
        { day: d('2026-01-01'), weightKg: 300.05 },
        { day: d('2026-04-11'), weightKg: 300 },
      ]),
    ).toBe(-1);
    // 0,0004 kg/día: redondea a 0.
    expect(
      regressionGainMilli([
        { day: d('2026-01-01'), weightKg: 300 },
        { day: d('2026-04-11'), weightKg: 300.04 },
      ]),
    ).toBe(0);
  });

  it('todos el mismo día: no hay pendiente', () => {
    expect(
      regressionGainMilli([
        { day: d('2026-01-01'), weightKg: 300 },
        { day: d('2026-01-01'), weightKg: 310 },
      ]),
    ).toBeNull();
    expect(regressionGainMilli([])).toBeNull();
  });

  it('convierte entre milésimas y kg/día', () => {
    expect(gainFromMilli(435)).toBe(0.435);
    expect(gainToMilli(0.3)).toBe(300);
    expect(gainToMilli(0.355)).toBe(355);
  });
});

describe('ventana de 90 días con ancla (ADR-015)', () => {
  it('pesaje trimestral: el ancla del 15/06 completa la ventana del 15/09', () => {
    const records = [w('2026-03-15', 260), w('2026-06-15', 300), w('2026-09-15', 340)];
    const points = last90DaysPoints({ records, anchorMaxDays: 180, today: HOY });
    expect(points?.map((record) => record.weighedOn)).toEqual(['2026-06-15', '2026-09-15']);
    expect(weightGains({ records, anchorMaxDays: 180, today: HOY }).last90DaysMilli).toBe(435);
  });

  it('sin ningún pesaje dentro de la ventana no hay ganancia de 90 días', () => {
    const records = [w('2026-03-15', 260), w('2026-06-15', 300)];
    expect(last90DaysPoints({ records, anchorMaxDays: 180, today: HOY })).toBeNull();
  });

  it('el ancla puede estar hasta 180 días antes del inicio de la ventana, no más', () => {
    // La ventana empieza el 27/06/2026; 180 días antes es el 29/12/2025.
    const inLimit = [w('2025-12-29', 200), w('2026-09-15', 340)];
    expect(last90DaysPoints({ records: inLimit, anchorMaxDays: 180, today: HOY })).not.toBeNull();
    const tooOld = [w('2025-12-28', 200), w('2026-09-15', 340)];
    expect(last90DaysPoints({ records: tooOld, anchorMaxDays: 180, today: HOY })).toBeNull();
  });

  it('exige 30 días entre el primer y el último pesaje', () => {
    const short = [w('2026-09-01', 330), w('2026-09-30', 340)];
    expect(
      last90DaysPoints({ records: short, anchorMaxDays: 180, today: d('2026-09-30') }),
    ).toBeNull();
    const enough = [w('2026-08-31', 330), w('2026-09-30', 340)];
    expect(
      last90DaysPoints({ records: enough, anchorMaxDays: 180, today: d('2026-09-30') }),
    ).toHaveLength(2);
  });

  it('usa todos los pesajes de la ventana y no cuenta los anulados', () => {
    const records = [
      w('2026-06-01', 300),
      w('2026-07-01', 315),
      w('2026-08-01', 999, { voided: true }),
      w('2026-08-31', 330),
    ];
    const points = last90DaysPoints({ records, anchorMaxDays: 180, today: HOY });
    expect(points?.map((record) => record.weightKg)).toEqual([300, 315, 330]);
  });
});

describe('weightGains (PES-02, PES-05 CA1)', () => {
  it('entre los dos últimos, en 90 días y desde el nacimiento', () => {
    const records = [
      w('2025-09-15', 32, { isBirthWeight: true }),
      w('2026-06-15', 200),
      w('2026-09-15', 240),
    ];
    const gains = weightGains({ records, anchorMaxDays: 180, today: HOY });
    expect(gains.lastTwoMilli).toBe(435);
    expect(gains.last90DaysMilli).toBe(435);
    // 208 kg en 365 días = 0,5699 → 0,570
    expect(gains.sinceBirthMilli).toBe(570);
  });

  it('dos pesajes el mismo día: los «dos últimos» toman el de una fecha anterior', () => {
    const records = [w('2026-06-15', 200), w('2026-09-15', 238), w('2026-09-15', 240)];
    const pair = lastTwoWeights(records);
    expect(pair?.last.weightKg).toBe(240);
    expect(pair?.previous?.weighedOn).toBe('2026-06-15');
  });

  it('sin peso al nacer o con un solo pesaje, lo que no se puede calcular es null', () => {
    const gains = weightGains({ records: [w('2026-09-15', 240)], anchorMaxDays: 180, today: HOY });
    expect(gains).toEqual({ lastTwoMilli: null, last90DaysMilli: null, sinceBirthMilli: null });
  });
});

describe('weightAlerts (PES-05 CA2 y CA3)', () => {
  /** Dos pesajes separados 200 días dentro de la ventana con su ancla, con la diferencia dada. */
  const pair = (deltaKg: number) => [w('2026-03-09', 300), w('2026-09-25', 300 + deltaKg)];

  it('ganancia baja: compara la ganancia ya redondeada con el umbral', () => {
    // 59,90 kg / 200 días = 0,2995 → 0,300: justo en el umbral, sin alerta.
    expect(
      weightAlerts({ records: pair(59.9), category: 'YOUNG_MALE', settings: SETTINGS, today: HOY })
        .lowGain,
    ).toBe(false);
    // 59,88 kg / 200 días = 0,2994 → 0,299: por debajo, con alerta.
    const low = weightAlerts({
      records: pair(59.88),
      category: 'YOUNG_MALE',
      settings: SETTINGS,
      today: HOY,
    });
    expect(low.gains.last90DaysMilli).toBe(299);
    expect(low.lowGain).toBe(true);
  });

  it('una categoría sin umbral no alerta', () => {
    expect(
      weightAlerts({ records: pair(1), category: 'HEIFER', settings: SETTINGS, today: HOY })
        .lowGain,
    ).toBe(false);
  });

  it('perdió peso: más del 5 % alerta; exactamente el 5 %, no', () => {
    const exact = [w('2026-06-15', 300), w('2026-09-15', 285)];
    expect(
      weightAlerts({ records: exact, category: 'COW', settings: SETTINGS, today: HOY }).weightLoss,
    ).toBe(false);
    const more = [w('2026-06-15', 300), w('2026-09-15', 284.99)];
    const result = weightAlerts({ records: more, category: 'COW', settings: SETTINGS, today: HOY });
    expect(result.weightLoss).toBe(true);
    expect(result.lossPercent).toBe(5);
    expect(isWeightLoss(300, 285, 5)).toBe(false);
  });

  it('sin pesaje anterior no hay pérdida', () => {
    expect(
      weightAlerts({
        records: [w('2026-09-15', 200)],
        category: 'COW',
        settings: SETTINGS,
        today: HOY,
      }).weightLoss,
    ).toBe(false);
  });
});

describe('peso atípico (PES-01 CA2)', () => {
  it('más del 30 % de diferencia advierte; exactamente el 30 %, no', () => {
    expect(isWeightOutlier(300, 390)).toBe(false);
    expect(isWeightOutlier(300, 390.01)).toBe(true);
    expect(isWeightOutlier(300, 210)).toBe(false);
    expect(isWeightOutlier(300, 209.99)).toBe(true);
  });

  it('se compara con el último pesaje válido de ese día o de antes', () => {
    const records = [
      w('2026-06-15', 300),
      w('2026-07-15', 999, { voided: true }),
      w('2026-10-15', 360),
    ];
    expect(previousWeightFor(records, d('2026-09-15'))?.weightKg).toBe(300);
    expect(previousWeightFor(records, d('2026-01-01'))).toBeNull();
    expect(previousWeightFor(records, addDays(d('2026-10-15'), 0))?.weightKg).toBe(360);
  });
});
