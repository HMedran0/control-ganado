import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import { ANIMAL_ALERT } from '../enums.js';
import {
  animalAlerts,
  isCalvingSoon,
  isServiceUnconfirmedOverdue,
  type AnimalAlertsInput,
} from './alerts.js';
import { VACCINE_STATUS } from './vaccination.js';

const d = toIsoDate;
const HOY = d('2026-09-25');

describe('isCalvingSoon', () => {
  const soon = (expected: string) =>
    isCalvingSoon({ expectedCalvingDate: d(expected), calvingAlertDays: 30, today: HOY });

  it('dentro de la ventana, incluido el último día', () => {
    expect(soon('2026-09-26')).toBe(true);
    expect(soon('2026-10-25')).toBe(true);
  });

  it('un día después de la ventana, no', () => {
    expect(soon('2026-10-26')).toBe(false);
  });

  it('una fecha estimada ya pasada sigue siendo alerta', () => {
    expect(soon('2026-09-01')).toBe(true);
  });
});

describe('isServiceUnconfirmedOverdue (RN-08)', () => {
  const overdue = (service: string) =>
    isServiceUnconfirmedOverdue({ serviceDate: d(service), alertDays: 90, today: HOY });

  it('exactamente 90 días todavía no; 91 sí («más de 90 días»)', () => {
    expect(overdue('2026-06-27')).toBe(false);
    expect(overdue('2026-06-26')).toBe(true);
  });
});

describe('animalAlerts', () => {
  const base: AnimalAlertsInput = {
    openPregnancy: null,
    withdrawalUntil: null,
    vaccineStatuses: [],
    calvingAlertDays: 30,
    unconfirmedServiceAlertDays: 90,
    today: HOY,
  };

  it('sin nada, sin alertas', () => {
    expect(animalAlerts(base)).toEqual([]);
    expect(
      animalAlerts({
        ...base,
        vaccineStatuses: [VACCINE_STATUS.UP_TO_DATE, VACCINE_STATUS.NOT_APPLICABLE],
      }),
    ).toEqual([]);
  });

  it('vacunas: vencida por un lado, pendiente o próxima por otro', () => {
    expect(animalAlerts({ ...base, vaccineStatuses: [VACCINE_STATUS.OVERDUE] })).toEqual([
      ANIMAL_ALERT.VACCINE_OVERDUE,
    ]);
    expect(animalAlerts({ ...base, vaccineStatuses: [VACCINE_STATUS.PENDING] })).toEqual([
      ANIMAL_ALERT.VACCINE_DUE,
    ]);
    expect(
      animalAlerts({
        ...base,
        vaccineStatuses: [VACCINE_STATUS.UPCOMING, VACCINE_STATUS.OVERDUE],
      }),
    ).toEqual([ANIMAL_ALERT.VACCINE_OVERDUE, ANIMAL_ALERT.VACCINE_DUE]);
  });

  it('parto próximo solo con la preñez confirmada', () => {
    const pregnancy = {
      serviceDate: d('2026-01-01'),
      confirmedAt: d('2026-03-01'),
      expectedCalvingDate: d('2026-10-10'),
    };
    expect(animalAlerts({ ...base, openPregnancy: pregnancy })).toEqual([
      ANIMAL_ALERT.CALVING_SOON,
    ]);
    // Sin confirmar no hay parto próximo, pero sí servida sin diagnóstico (más de 90 días).
    expect(animalAlerts({ ...base, openPregnancy: { ...pregnancy, confirmedAt: null } })).toEqual([
      ANIMAL_ALERT.UNCONFIRMED_SERVICE,
    ]);
  });

  it('servida reciente sin diagnóstico: todavía no es alerta', () => {
    expect(
      animalAlerts({
        ...base,
        openPregnancy: {
          serviceDate: d('2026-09-01'),
          confirmedAt: null,
          expectedCalvingDate: d('2027-06-20'),
        },
      }),
    ).toEqual([]);
  });

  it('retiro vigente hasta hoy inclusive', () => {
    expect(animalAlerts({ ...base, withdrawalUntil: HOY })).toEqual([ANIMAL_ALERT.WITHDRAWAL]);
    expect(animalAlerts({ ...base, withdrawalUntil: d('2026-09-24') })).toEqual([]);
  });
});
