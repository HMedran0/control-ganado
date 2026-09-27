import { describe, expect, it } from 'vitest';

import { toIsoDate, type IsoDate } from '../date.js';
import { SEX, VACCINE_SCHEDULE_TYPE } from '../enums.js';
import {
  VACCINE_STATUS,
  VACCINE_STATUS_REASON,
  canApplyVaccine,
  cyclesAt,
  nextDueOnFromInterval,
  vaccineStatus,
  vaccineSexBlockedParams,
  type VaccinationCycleLike,
  type VaccineSchedule,
  type VaccineStatusInput,
} from './vaccination.js';

const d = toIsoDate;
const HOY = d('2026-09-25');

/** Aftosa: ciclo oficial, todos los bovinos (08 §3.3). */
const AFTOSA: VaccineSchedule = {
  scheduleType: VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE,
  boosterIntervalDays: null,
  eligibleSex: null,
  minAgeDays: null,
  maxAgeDays: null,
  blockIneligibleSex: false,
};

/** Brucelosis RB51: ventana de edad, hembras de 90 a 270 días, bloquea machos (08 §1.5). */
const BRUCELOSIS: VaccineSchedule = {
  scheduleType: VACCINE_SCHEDULE_TYPE.AGE_WINDOW,
  boosterIntervalDays: null,
  eligibleSex: SEX.FEMALE,
  minAgeDays: 90,
  maxAgeDays: 270,
  blockIneligibleSex: true,
};

/** Clostridial polivalente: intervalo anual desde los 90 días. */
const CLOSTRIDIAL: VaccineSchedule = {
  scheduleType: VACCINE_SCHEDULE_TYPE.INTERVAL,
  boosterIntervalDays: 365,
  eligibleSex: null,
  minAgeDays: 90,
  maxAgeDays: null,
  blockIneligibleSex: false,
};

const SIN_ALERTA: VaccineSchedule = { ...AFTOSA, scheduleType: VACCINE_SCHEDULE_TYPE.NONE };

/** Ciclo 2026-1 real: 4 de mayo al 23 de junio de 2026 (ICA). */
const CICLO_2026_1: VaccinationCycleLike = {
  name: '2026-1',
  startsOn: d('2026-05-04'),
  endsOn: d('2026-06-23'),
};
/** Ciclo 2026-2 ficticio: 1 de noviembre al 15 de diciembre de 2026. */
const CICLO_2026_2: VaccinationCycleLike = {
  name: '2026-2',
  startsOn: d('2026-11-01'),
  endsOn: d('2026-12-15'),
};

function estado(overrides: Partial<VaccineStatusInput>) {
  const base: VaccineStatusInput = {
    vaccine: AFTOSA,
    animal: { sex: SEX.FEMALE, birthDate: d('2020-01-15'), entryDate: d('2020-01-15') },
    records: [],
    currentCycle: null,
    lastClosedCycle: CICLO_2026_1,
    alertDays: 15,
    today: HOY,
  };
  return vaccineStatus({ ...base, ...overrides });
}

describe('NONE: nunca alerta', () => {
  it('siempre no aplica', () => {
    const resultado = estado({ vaccine: SIN_ALERTA });
    expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.NO_SCHEDULE);
  });
});

describe('OFFICIAL_CYCLE (RN-13)', () => {
  it('pendiente si el ciclo está en curso y no hay aplicación', () => {
    const resultado = estado({ currentCycle: CICLO_2026_2, today: d('2026-11-10') });
    expect(resultado.kind).toBe(VACCINE_STATUS.PENDING);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.CURRENT_CYCLE);
    expect(resultado.dueOn).toBe('2026-12-15');
  });

  it('al día si la aplicación cae dentro del ciclo en curso', () => {
    const resultado = estado({
      currentCycle: CICLO_2026_2,
      today: d('2026-11-10'),
      records: [{ appliedOn: d('2026-11-05'), nextDueOn: null, voided: false }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.UP_TO_DATE);
    expect(resultado.lastAppliedOn).toBe('2026-11-05');
  });

  it('vencida si faltó la del último ciclo cerrado', () => {
    const resultado = estado({ currentCycle: null, lastClosedCycle: CICLO_2026_1 });
    expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.CLOSED_CYCLE);
    expect(resultado.dueOn).toBe('2026-06-23');
  });

  it('al día si la aplicación cae dentro del ciclo cerrado', () => {
    const resultado = estado({
      records: [{ appliedOn: d('2026-05-20'), nextDueOn: null, voided: false }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.UP_TO_DATE);
    expect(resultado.lastAppliedOn).toBe('2026-05-20');
  });

  it('una aplicación fuera del ciclo no cuenta para ese ciclo', () => {
    const resultado = estado({
      records: [{ appliedOn: d('2026-04-30'), nextDueOn: null, voided: false }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
    expect(resultado.lastAppliedOn).toBe('2026-04-30');
  });

  it('las aplicaciones anuladas no cuentan (RN-13)', () => {
    const resultado = estado({
      records: [{ appliedOn: d('2026-05-20'), nextDueOn: null, voided: true }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
    expect(resultado.lastAppliedOn).toBeNull();
  });

  it('acepta las aplicaciones en los extremos del ciclo', () => {
    for (const día of ['2026-05-04', '2026-06-23']) {
      const resultado = estado({
        records: [{ appliedOn: d(día), nextDueOn: null, voided: false }],
      });
      expect(resultado.kind, día).toBe(VACCINE_STATUS.UP_TO_DATE);
    }
  });

  it('un animal nacido después del cierre del ciclo no queda vencido', () => {
    const resultado = estado({
      animal: { sex: SEX.FEMALE, birthDate: d('2026-07-01'), entryDate: d('2026-07-01') },
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.NOT_IN_FARM_DURING_CYCLE);
  });

  it('sin ciclos configurados no aplica', () => {
    const resultado = estado({ currentCycle: null, lastClosedCycle: null });
    expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.NO_CYCLE);
  });

  describe('animales que no estaban en la finca durante el ciclo (RN-13, ADR-004)', () => {
    it('un animal comprado que ingresó después del cierre no queda vencido', () => {
      const resultado = estado({
        animal: { sex: SEX.FEMALE, birthDate: d('2023-04-10'), entryDate: d('2026-08-01') },
      });
      expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
      expect(resultado.reason).toBe(VACCINE_STATUS_REASON.NOT_IN_FARM_DURING_CYCLE);
    });

    it('un animal comprado antes del cierre sí queda vencido', () => {
      const resultado = estado({
        animal: { sex: SEX.FEMALE, birthDate: d('2023-04-10'), entryDate: d('2026-05-10') },
      });
      expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
      expect(resultado.reason).toBe(VACCINE_STATUS_REASON.CLOSED_CYCLE);
    });

    it('el día del cierre cuenta como estar en la finca', () => {
      const resultado = estado({
        animal: { sex: SEX.FEMALE, birthDate: d('2023-04-10'), entryDate: d('2026-06-23') },
      });
      expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
      expect(resultado.reason).toBe(VACCINE_STATUS_REASON.CLOSED_CYCLE);
    });

    it('el día siguiente al cierre ya no', () => {
      const resultado = estado({
        animal: { sex: SEX.FEMALE, birthDate: d('2023-04-10'), entryDate: d('2026-06-24') },
      });
      expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
      expect(resultado.reason).toBe(VACCINE_STATUS_REASON.NOT_IN_FARM_DURING_CYCLE);
    });

    it('manda la fecha más tardía entre nacimiento e ingreso', () => {
      // Nacido después de que cerró el ciclo, con un ingreso anterior por dato inconsistente:
      // igual no pudo vacunarse, porque no había nacido.
      const resultado = estado({
        animal: { sex: SEX.FEMALE, birthDate: d('2026-07-01'), entryDate: d('2026-05-10') },
      });
      expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
      expect(resultado.reason).toBe(VACCINE_STATUS_REASON.NOT_IN_FARM_DURING_CYCLE);
    });

    it('un animal comprado que ingresó durante el ciclo en curso queda pendiente', () => {
      const resultado = estado({
        currentCycle: CICLO_2026_2,
        today: d('2026-11-10'),
        animal: { sex: SEX.FEMALE, birthDate: d('2023-04-10'), entryDate: d('2026-11-05') },
      });
      expect(resultado.kind).toBe(VACCINE_STATUS.PENDING);
      expect(resultado.reason).toBe(VACCINE_STATUS_REASON.CURRENT_CYCLE);
    });
  });
});

describe('AGE_WINDOW: brucelosis (RN-13, 08 §1.5)', () => {
  /** Nacimiento para que la ternera tenga esa edad en días hoy. */
  function nacidaHaceDias(days: number): IsoDate {
    const fecha = new Date(Date.UTC(2026, 8, 25) - days * 86_400_000);
    return d(fecha.toISOString().slice(0, 10));
  }

  it('macho: no aplica nunca', () => {
    const resultado = estado({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.MALE, birthDate: nacidaHaceDias(200), entryDate: nacidaHaceDias(200) },
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.NOT_ELIGIBLE_SEX);
  });

  it('ternera de 2 meses: todavía no le toca', () => {
    const resultado = estado({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: nacidaHaceDias(60), entryDate: nacidaHaceDias(60) },
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.BEFORE_AGE_WINDOW);
  });

  it('ternera de 8 meses sin aplicación: pendiente', () => {
    const resultado = estado({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: nacidaHaceDias(240), entryDate: nacidaHaceDias(240) },
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.PENDING);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.IN_AGE_WINDOW);
    expect(resultado.dueOn).toBe(nacidaHaceDias(240 - 270));
  });

  it('ternera de 10 meses sin aplicación: vencida, fuera de edad', () => {
    const resultado = estado({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: nacidaHaceDias(300), entryDate: nacidaHaceDias(300) },
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.AFTER_AGE_WINDOW);
  });

  it('los extremos de la ventana están dentro', () => {
    for (const días of [90, 270]) {
      const resultado = estado({
        vaccine: BRUCELOSIS,
        animal: {
          sex: SEX.FEMALE,
          birthDate: nacidaHaceDias(días),
          entryDate: nacidaHaceDias(días),
        },
      });
      expect(resultado.kind, String(días)).toBe(VACCINE_STATUS.PENDING);
    }
    expect(
      estado({
        vaccine: BRUCELOSIS,
        animal: { sex: SEX.FEMALE, birthDate: nacidaHaceDias(89), entryDate: nacidaHaceDias(89) },
      }).kind,
    ).toBe(VACCINE_STATUS.NOT_APPLICABLE);
    expect(
      estado({
        vaccine: BRUCELOSIS,
        animal: { sex: SEX.FEMALE, birthDate: nacidaHaceDias(271), entryDate: nacidaHaceDias(271) },
      }).kind,
    ).toBe(VACCINE_STATUS.OVERDUE);
  });

  it('una aplicación cierra la alerta para siempre', () => {
    const resultado = estado({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: nacidaHaceDias(300), entryDate: nacidaHaceDias(300) },
      records: [{ appliedOn: d('2026-04-01'), nextDueOn: null, voided: false }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.UP_TO_DATE);
  });

  it('una aplicación anulada no cierra la alerta (RN-13)', () => {
    const resultado = estado({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: nacidaHaceDias(240), entryDate: nacidaHaceDias(240) },
      records: [{ appliedOn: d('2026-04-01'), nextDueOn: null, voided: true }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.PENDING);
  });
});

describe('INTERVAL (RN-12, RN-13)', () => {
  it('sin aplicación y con edad suficiente: pendiente', () => {
    const resultado = estado({
      vaccine: CLOSTRIDIAL,
      animal: { sex: SEX.FEMALE, birthDate: d('2025-01-01'), entryDate: d('2025-01-01') },
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.PENDING);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.NO_RECORD);
  });

  it('sin aplicación y demasiado joven: no aplica', () => {
    const resultado = estado({
      vaccine: CLOSTRIDIAL,
      animal: { sex: SEX.FEMALE, birthDate: d('2026-09-01'), entryDate: d('2026-09-01') },
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.NOT_APPLICABLE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.BEFORE_AGE_WINDOW);
    expect(resultado.dueOn).toBe('2026-11-30');
  });

  it('vencida si la fecha de refuerzo ya pasó', () => {
    const resultado = estado({
      vaccine: CLOSTRIDIAL,
      records: [{ appliedOn: d('2025-09-01'), nextDueOn: d('2026-09-01'), voided: false }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.INTERVAL_ELAPSED);
    expect(resultado.dueOn).toBe('2026-09-01');
  });

  it('próxima si cae dentro de la ventana de alerta', () => {
    const resultado = estado({
      vaccine: CLOSTRIDIAL,
      records: [{ appliedOn: d('2025-10-05'), nextDueOn: d('2026-10-05'), voided: false }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.UPCOMING);
    expect(resultado.reason).toBe(VACCINE_STATUS_REASON.INTERVAL_NEAR);
  });

  it('al día si el refuerzo está más allá de la ventana', () => {
    const resultado = estado({
      vaccine: CLOSTRIDIAL,
      records: [{ appliedOn: d('2026-06-01'), nextDueOn: d('2027-06-01'), voided: false }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.UP_TO_DATE);
  });

  it('los extremos: hoy es próxima, ayer es vencida', () => {
    expect(
      estado({
        vaccine: CLOSTRIDIAL,
        records: [{ appliedOn: d('2025-09-25'), nextDueOn: HOY, voided: false }],
      }).kind,
    ).toBe(VACCINE_STATUS.UPCOMING);
    expect(
      estado({
        vaccine: CLOSTRIDIAL,
        records: [{ appliedOn: d('2025-09-24'), nextDueOn: d('2026-09-24'), voided: false }],
      }).kind,
    ).toBe(VACCINE_STATUS.OVERDUE);
    // Último día dentro de la ventana de 15 días.
    expect(
      estado({
        vaccine: CLOSTRIDIAL,
        records: [{ appliedOn: d('2025-10-10'), nextDueOn: d('2026-10-10'), voided: false }],
      }).kind,
    ).toBe(VACCINE_STATUS.UPCOMING);
    expect(
      estado({
        vaccine: CLOSTRIDIAL,
        records: [{ appliedOn: d('2025-10-11'), nextDueOn: d('2026-10-11'), voided: false }],
      }).kind,
    ).toBe(VACCINE_STATUS.UP_TO_DATE);
  });

  it('calcula el refuerzo desde el intervalo si no viene guardado', () => {
    const resultado = estado({
      vaccine: CLOSTRIDIAL,
      records: [{ appliedOn: d('2025-09-01'), nextDueOn: null, voided: false }],
    });
    expect(resultado.dueOn).toBe('2026-09-01');
    expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
  });

  it('sin intervalo ni fecha de refuerzo queda al día', () => {
    const resultado = estado({
      vaccine: { ...CLOSTRIDIAL, boosterIntervalDays: null },
      records: [{ appliedOn: d('2020-01-01'), nextDueOn: null, voided: false }],
    });
    expect(resultado.kind).toBe(VACCINE_STATUS.UP_TO_DATE);
  });

  it('toma la aplicación más reciente entre varias', () => {
    const resultado = estado({
      vaccine: CLOSTRIDIAL,
      records: [
        { appliedOn: d('2024-06-01'), nextDueOn: d('2025-06-01'), voided: false },
        { appliedOn: d('2026-06-01'), nextDueOn: d('2027-06-01'), voided: false },
        { appliedOn: d('2025-06-01'), nextDueOn: d('2026-06-01'), voided: false },
      ],
    });
    expect(resultado.lastAppliedOn).toBe('2026-06-01');
    expect(resultado.kind).toBe(VACCINE_STATUS.UP_TO_DATE);
  });

  it('ignora la más reciente si está anulada', () => {
    const resultado = estado({
      vaccine: CLOSTRIDIAL,
      records: [
        { appliedOn: d('2025-09-01'), nextDueOn: d('2026-09-01'), voided: false },
        { appliedOn: d('2026-09-01'), nextDueOn: d('2027-09-01'), voided: true },
      ],
    });
    expect(resultado.lastAppliedOn).toBe('2025-09-01');
    expect(resultado.kind).toBe(VACCINE_STATUS.OVERDUE);
  });
});

describe('nextDueOnFromInterval (RN-12)', () => {
  it('suma el intervalo a la aplicación', () => {
    expect(nextDueOnFromInterval(d('2026-09-25'), 365)).toBe('2027-09-25');
    expect(nextDueOnFromInterval(d('2024-03-01'), 365)).toBe('2025-03-01');
  });

  it('no calcula nada sin intervalo', () => {
    expect(nextDueOnFromInterval(d('2026-09-25'), null)).toBeNull();
    expect(nextDueOnFromInterval(d('2026-09-25'), 0)).toBeNull();
    expect(nextDueOnFromInterval(d('2026-09-25'), -10)).toBeNull();
  });
});

describe('canApplyVaccine (RN-26)', () => {
  it('bloquea brucelosis en macho, que es norma del ICA', () => {
    const resultado = canApplyVaccine({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.MALE, birthDate: d('2026-03-01'), entryDate: d('2026-03-01') },
      vaccineName: 'Brucelosis RB51',
      appliedOn: HOY,
    });
    expect(resultado.blocked).toBe(true);
    expect(resultado.errorCode).toBe('VACCINE_SEX_BLOCKED');
    expect(resultado.warnings).toEqual([]);
  });

  it('permite brucelosis en hembra dentro de la ventana, sin advertencias', () => {
    const resultado = canApplyVaccine({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: d('2026-03-01'), entryDate: d('2026-03-01') },
      vaccineName: 'Brucelosis RB51',
      appliedOn: HOY,
    });
    expect(resultado.blocked).toBe(false);
    expect(resultado.warnings).toEqual([]);
  });

  it('advierte sin bloquear si la hembra está fuera de la ventana de edad', () => {
    const resultado = canApplyVaccine({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: d('2024-01-01'), entryDate: d('2024-01-01') },
      vaccineName: 'Brucelosis RB51',
      appliedOn: HOY,
    });
    expect(resultado.blocked).toBe(false);
    expect(resultado.warnings).toHaveLength(1);
    expect(resultado.warnings[0]?.code).toBe('VACCINE_AGE_OUTSIDE_WINDOW');
    expect(resultado.warnings[0]?.message).toContain('Brucelosis RB51');
  });

  it('advierte si todavía es muy joven', () => {
    const resultado = canApplyVaccine({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: d('2026-09-01'), entryDate: d('2026-09-01') },
      vaccineName: 'Brucelosis RB51',
      appliedOn: HOY,
    });
    expect(resultado.warnings[0]?.code).toBe('VACCINE_AGE_OUTSIDE_WINDOW');
  });

  it('evalúa la edad el día de la aplicación, no hoy', () => {
    const resultado = canApplyVaccine({
      vaccine: BRUCELOSIS,
      animal: { sex: SEX.FEMALE, birthDate: d('2024-01-01'), entryDate: d('2024-01-01') },
      vaccineName: 'Brucelosis RB51',
      appliedOn: d('2024-06-01'),
    });
    expect(resultado.warnings).toEqual([]);
  });

  it('no bloquea si la vacuna no lo pide, aunque el sexo no sea el elegible', () => {
    const resultado = canApplyVaccine({
      vaccine: { ...BRUCELOSIS, blockIneligibleSex: false },
      animal: { sex: SEX.MALE, birthDate: d('2026-03-01'), entryDate: d('2026-03-01') },
      vaccineName: 'Vacuna de la finca',
      appliedOn: HOY,
    });
    expect(resultado.blocked).toBe(false);
  });

  it('aftosa se aplica a cualquier animal', () => {
    const resultado = canApplyVaccine({
      vaccine: AFTOSA,
      animal: { sex: SEX.MALE, birthDate: d('2026-09-20'), entryDate: d('2026-09-20') },
      vaccineName: 'Aftosa',
      appliedOn: HOY,
    });
    expect(resultado.blocked).toBe(false);
    expect(resultado.warnings).toEqual([]);
  });
});

describe('vaccineSexBlockedParams', () => {
  it('traduce el sexo para el mensaje', () => {
    expect(vaccineSexBlockedParams('Brucelosis RB51', SEX.MALE)).toEqual({
      vaccine: 'Brucelosis RB51',
      sex: 'machos',
    });
    expect(vaccineSexBlockedParams('Vacuna', SEX.FEMALE).sex).toBe('hembras');
  });
});

describe('cyclesAt', () => {
  const ciclos = [
    { name: '2025-2', startsOn: toIsoDate('2025-11-01'), endsOn: toIsoDate('2025-12-15') },
    { name: '2026-1', startsOn: toIsoDate('2026-05-01'), endsOn: toIsoDate('2026-06-23') },
    { name: '2026-2', startsOn: toIsoDate('2026-11-01'), endsOn: toIsoDate('2026-12-15') },
  ];
  const at = (date: string) => {
    const { current, lastClosed } = cyclesAt(ciclos, toIsoDate(date));
    return [current?.name ?? null, lastClosed?.name ?? null];
  };

  it('entre ciclos: ninguno en curso y el último cerrado', () => {
    expect(at('2026-09-25')).toEqual([null, '2026-1']);
  });

  it('el primer y el último día del ciclo están en curso', () => {
    expect(at('2026-05-01')).toEqual(['2026-1', '2025-2']);
    expect(at('2026-06-23')).toEqual(['2026-1', '2025-2']);
    expect(at('2026-06-24')).toEqual([null, '2026-1']);
  });

  it('antes de todo ciclo, nada', () => {
    expect(at('2025-01-01')).toEqual([null, null]);
  });
});
