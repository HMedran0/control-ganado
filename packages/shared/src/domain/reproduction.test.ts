import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import { PREGNANCY_OUTCOME, type PregnancyOutcome } from '../enums.js';
import { suggestCodes } from './codes.js';
import {
  calvingIntervalBucket,
  calvingIntervals,
  estimatedServiceDate,
  herdCalvingIntervals,
  gestationDaysElapsed,
  isBreedingAgeLow,
  isCalvingOverdue,
  serviceDateFromGestationMonths,
  type CalvingIntervalPregnancy,
} from './reproduction.js';

const d = toIsoDate;
const HOY = d('2026-09-25');

const calving = (
  date: string | null,
  options: { estimated?: boolean; voided?: boolean; outcome?: PregnancyOutcome } = {},
): CalvingIntervalPregnancy => ({
  outcome: options.outcome ?? PREGNANCY_OUTCOME.CALVED,
  outcomeDate: date === null ? null : d(date),
  serviceDateEstimated: options.estimated ?? false,
  voided: options.voided ?? false,
});

describe('calvingIntervals (REP-05, RN-38)', () => {
  it('días entre partos consecutivos, del más antiguo al más reciente', () => {
    const result = calvingIntervals([
      calving('2025-11-10'),
      calving('2024-10-01'),
      calving('2023-09-15'),
    ]);
    expect(result.intervals).toEqual([
      { from: '2023-09-15', to: '2024-10-01', days: 382 },
      { from: '2024-10-01', to: '2025-11-10', days: 405 },
    ]);
    expect(result.lastDays).toBe(405);
    expect(result.averageDays).toBe(394);
  });

  it('sin partos o con uno solo no hay intervalo', () => {
    expect(calvingIntervals([])).toEqual({ intervals: [], lastDays: null, averageDays: null });
    expect(calvingIntervals([calving('2025-01-01')]).lastDays).toBeNull();
  });

  it('RN-38: un parto con servicio estimado no entra, ni en su par anterior ni en el siguiente', () => {
    const result = calvingIntervals([
      calving('2022-09-01'),
      calving('2023-09-10'),
      calving('2024-10-01', { estimated: true }),
      calving('2025-11-10'),
    ]);
    // Solo 2022→2023: 2023→2024 y 2024→2025 tocan el estimado, y no se une 2023 con 2025.
    expect(result.intervals).toEqual([{ from: '2022-09-01', to: '2023-09-10', days: 374 }]);
    expect(result.lastDays).toBe(374);
  });

  it('RN-38: el último parto importado (servicio estimado) no da intervalo con el primero registrado', () => {
    const result = calvingIntervals([
      calving('2025-03-01', { estimated: true }),
      calving('2026-04-10'),
    ]);
    expect(result).toEqual({ intervals: [], lastDays: null, averageDays: null });
  });

  it('las anuladas, los abortos y los partos sin fecha no cuentan', () => {
    const result = calvingIntervals([
      calving('2024-01-01'),
      calving('2024-06-01', { voided: true }),
      calving('2024-08-01', { outcome: PREGNANCY_OUTCOME.ABORTED }),
      calving(null),
      calving('2025-02-01'),
    ]);
    expect(result.intervals).toEqual([{ from: '2024-01-01', to: '2025-02-01', days: 397 }]);
  });
});

describe('isCalvingOverdue', () => {
  const overdue = (expected: string, days = 15) =>
    isCalvingOverdue({
      expectedCalvingDate: d(expected),
      overdueCalvingAlertDays: days,
      today: HOY,
    });

  it('más de los días configurados después del parto estimado', () => {
    expect(overdue('2026-09-10')).toBe(false);
    expect(overdue('2026-09-09')).toBe(true);
  });

  it('un parto estimado futuro o de hoy no está vencido', () => {
    expect(overdue('2026-10-01')).toBe(false);
    expect(overdue('2026-09-25', 0)).toBe(false);
    expect(overdue('2026-09-24', 0)).toBe(true);
  });
});

describe('fechas de la preñez', () => {
  it('días de gestación cumplidos, nunca negativos', () => {
    expect(gestationDaysElapsed(d('2026-01-12'), HOY)).toBe(256);
    expect(gestationDaysElapsed(d('2026-10-01'), HOY)).toBe(0);
  });

  it('servicio estimado desde los meses de gestación (REP-02 CA3), con recorte a fin de mes', () => {
    expect(serviceDateFromGestationMonths(d('2026-09-25'), 3)).toBe('2026-06-25');
    expect(serviceDateFromGestationMonths(d('2026-05-31'), 3)).toBe('2026-02-28');
  });

  it('servicio estimado de un parto sin preñez registrada (REP-04 CA1)', () => {
    expect(estimatedServiceDate(d('2026-09-20'), 293)).toBe('2025-12-01');
  });
});

describe('isBreedingAgeLow (RN-15, RN-23)', () => {
  it('advierte por debajo de la edad mínima en la fecha del servicio o del parto', () => {
    const low = (service: string) =>
      isBreedingAgeLow({
        birthDate: d('2025-01-15'),
        serviceDate: d(service),
        minBreedingAgeMonths: 15,
      });
    expect(low('2026-04-14')).toBe(true);
    expect(low('2026-04-15')).toBe(false);
  });
});

describe('suggestCodes (REP-04 CA3, ANI-10)', () => {
  it('patrón: consecutivos distintos para mellizos', () => {
    expect(
      suggestCodes({
        suggestion: 'PATTERN',
        pattern: '{YY}-{NNN}',
        year: 2026,
        existingCodes: ['26-044', '25-120'],
        count: 3,
      }),
    ).toEqual(['26-045', '26-046', '26-047']);
  });

  it('menor número libre: números libres distintos, llenando los huecos', () => {
    expect(
      suggestCodes({
        suggestion: 'LOWEST_FREE',
        pattern: '{YY}-{NNN}',
        year: 2026,
        existingCodes: ['1', '2', '4', '6'],
        count: 3,
      }),
    ).toEqual(['3', '5', '7']);
  });
});

describe('herdCalvingIntervals (M8a, RN-38)', () => {
  it('junta los intervalos válidos de todas las hembras: promedio de intervalos, no de promedios', () => {
    const result = herdCalvingIntervals([
      // 382 y 405
      [calving('2023-09-15'), calving('2024-10-01'), calving('2025-11-10')],
      // 450
      [calving('2024-01-01'), calving('2025-03-26')],
      // Un solo parto: no suma intervalos ni hembras.
      [calving('2025-05-05')],
      // El par con servicio estimado no entra (RN-38).
      [calving('2024-02-01', { estimated: true }), calving('2025-02-20')],
    ]);
    expect(result.count).toBe(3);
    expect(result.females).toBe(2);
    expect(result.averageDays).toBe(Math.round((382 + 405 + 450) / 3));
    expect(result.distribution).toEqual([
      { bucket: 'UNDER_365', count: 0 },
      { bucket: 'D365_399', count: 1 },
      { bucket: 'D400_439', count: 1 },
      { bucket: 'D440_499', count: 1 },
      { bucket: 'D500_PLUS', count: 0 },
    ]);
  });

  it('sin intervalos: promedio null y la distribución en ceros', () => {
    const result = herdCalvingIntervals([]);
    expect(result).toMatchObject({ count: 0, females: 0, averageDays: null });
    expect(result.distribution.every((item) => item.count === 0)).toBe(true);
  });

  it('los rangos incluyen el límite inferior y excluyen el superior', () => {
    expect(calvingIntervalBucket(364)).toBe('UNDER_365');
    expect(calvingIntervalBucket(365)).toBe('D365_399');
    expect(calvingIntervalBucket(399)).toBe('D365_399');
    expect(calvingIntervalBucket(400)).toBe('D400_439');
    expect(calvingIntervalBucket(440)).toBe('D440_499');
    expect(calvingIntervalBucket(500)).toBe('D500_PLUS');
    expect(calvingIntervalBucket(900)).toBe('D500_PLUS');
  });
});
