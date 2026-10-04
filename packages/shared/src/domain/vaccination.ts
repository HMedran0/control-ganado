/**
 * Estado de vacunación por animal y vacuna (RN-12, RN-13, RN-26 y 08 §1.5).
 *
 * Los cuatro tipos de programación se resuelven aquí y en ningún otro lugar: el tablero, los
 * listados, los reportes y la jornada de manejo usan esta misma función (RN-27).
 * Los registros anulados nunca cuentan (RN-13).
 */

import { addDays, isWithin, maxIsoDate, type IsoDate } from '../date.js';
import { VACCINE_SCHEDULE_TYPE, type Sex, type VaccineScheduleType } from '../enums.js';
import { warning, type ErrorCode, type Warning } from '../errors.js';
import { ageInDays } from './age.js';

/** Configuración de la vacuna que afecta las alertas (`Vaccine` en el modelo de datos). */
export type VaccineSchedule = {
  readonly scheduleType: VaccineScheduleType;
  /** Días hasta el refuerzo; solo se usa con `INTERVAL` (RN-12). */
  readonly boosterIntervalDays: number | null;
  /** Sexo al que aplica la vacuna; `null` si aplica a ambos. */
  readonly eligibleSex: Sex | null;
  /** Edad mínima en días; `null` si no hay mínimo. */
  readonly minAgeDays: number | null;
  /** Edad máxima en días; `null` si no hay máximo. */
  readonly maxAgeDays: number | null;
  /** Si es `true`, registrar en el sexo no elegible se bloquea (RN-26). */
  readonly blockIneligibleSex: boolean;
};

/** Registro de vacunación, reducido a lo que necesitan las alertas. */
export type VaccinationRecordLike = {
  readonly appliedOn: IsoDate;
  /** `next_due_on`; puede venir editada por el usuario (RN-12). */
  readonly nextDueOn: IsoDate | null;
  /** `voided_at IS NOT NULL`. Los anulados no cuentan (RN-13). */
  readonly voided: boolean;
};

/** Ciclo oficial de vacunación (`VaccinationCycle`). */
export type VaccinationCycleLike = {
  readonly name: string;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
};

/** Animal, reducido a lo que necesitan las alertas. */
export type AnimalForVaccine = {
  readonly sex: Sex;
  readonly birthDate: IsoDate;
  /**
   * `Animal.entryDate`: fecha de ingreso a la finca. En los nacidos en la finca es igual a
   * `birthDate`; en los comprados es posterior. Determina desde cuándo el animal pudo
   * vacunarse en un ciclo oficial (RN-13, ADR-004).
   */
  readonly entryDate: IsoDate;
  /**
   * La importación no traía la fecha de ingreso y tomó la de nacimiento (ANI-09 CA2, M4d). Se trata
   * como presente desde que nació: la fecha de ingreso no se usa (M6, ADR-004).
   */
  readonly entryDateEstimated: boolean;
};

/**
 * Desde cuándo está el animal en la finca, para los ciclos oficiales (RN-13, ADR-004): el máximo
 * de nacimiento e ingreso; con el ingreso estimado, el nacimiento.
 */
export function inFarmSince(animal: AnimalForVaccine): IsoDate {
  return animal.entryDateEstimated
    ? animal.birthDate
    : maxIsoDate(animal.birthDate, animal.entryDate);
}

/** Estado de la vacuna en un animal. */
export const VACCINE_STATUS = {
  /** No aplica: no es elegible, la vacuna no genera alertas o todavía no tiene la edad. */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  /** Al día: tiene la aplicación que correspondía. */
  UP_TO_DATE: 'UP_TO_DATE',
  /** Pendiente: le corresponde ahora y no la tiene. */
  PENDING: 'PENDING',
  /** Próxima: vence dentro de la ventana de alerta de la finca. */
  UPCOMING: 'UPCOMING',
  /** Vencida: pasó la oportunidad de aplicarla. */
  OVERDUE: 'OVERDUE',
} as const;
export type VaccineStatusKind = (typeof VACCINE_STATUS)[keyof typeof VACCINE_STATUS];

/** Motivo del estado, para explicarlo en la interfaz y en los reportes. */
export const VACCINE_STATUS_REASON = {
  /** La vacuna es `NONE`: no genera alertas. */
  NO_SCHEDULE: 'NO_SCHEDULE',
  /** El sexo del animal no es el elegible (brucelosis en machos). */
  NOT_ELIGIBLE_SEX: 'NOT_ELIGIBLE_SEX',
  /** Todavía no alcanza la edad mínima. */
  BEFORE_AGE_WINDOW: 'BEFORE_AGE_WINDOW',
  /** Está dentro de la ventana de edad y no tiene aplicación. */
  IN_AGE_WINDOW: 'IN_AGE_WINDOW',
  /** Pasó la edad máxima sin aplicación: «fuera de edad». */
  AFTER_AGE_WINDOW: 'AFTER_AGE_WINDOW',
  /** Falta la aplicación del ciclo oficial en curso. */
  CURRENT_CYCLE: 'CURRENT_CYCLE',
  /** Faltó la aplicación del último ciclo oficial cerrado. */
  CLOSED_CYCLE: 'CLOSED_CYCLE',
  /** La finca no tiene ciclos oficiales configurados. */
  NO_CYCLE: 'NO_CYCLE',
  /** El animal nació o ingresó a la finca después de que cerró el ciclo. */
  NOT_IN_FARM_DURING_CYCLE: 'NOT_IN_FARM_DURING_CYCLE',
  /** Nunca se le ha aplicado y la vacuna es de intervalo. */
  NO_RECORD: 'NO_RECORD',
  /** Ya tiene la aplicación vigente. */
  APPLIED: 'APPLIED',
  /** La fecha de refuerzo ya pasó. */
  INTERVAL_ELAPSED: 'INTERVAL_ELAPSED',
  /** La fecha de refuerzo está dentro de la ventana de alerta. */
  INTERVAL_NEAR: 'INTERVAL_NEAR',
} as const;
export type VaccineStatusReason =
  (typeof VACCINE_STATUS_REASON)[keyof typeof VACCINE_STATUS_REASON];

/** Resultado de `vaccineStatus`. */
export type VaccineStatus = {
  readonly kind: VaccineStatusKind;
  readonly reason: VaccineStatusReason;
  /** Fecha límite o de vencimiento cuando aplica. */
  readonly dueOn: IsoDate | null;
  /** Última aplicación no anulada. */
  readonly lastAppliedOn: IsoDate | null;
};

/** Entrada de `vaccineStatus`. */
export type VaccineStatusInput = {
  readonly vaccine: VaccineSchedule;
  readonly animal: AnimalForVaccine;
  /** Registros de esa vacuna en ese animal, anulados incluidos. */
  readonly records: readonly VaccinationRecordLike[];
  /** Ciclo oficial vigente hoy; `null` si hoy no hay ciclo abierto. */
  readonly currentCycle: VaccinationCycleLike | null;
  /** Último ciclo oficial que ya cerró; `null` si no hay ninguno. */
  readonly lastClosedCycle: VaccinationCycleLike | null;
  /** `Farm.settings.vaccineAlertDays`, 15 por defecto. */
  readonly alertDays: number;
  readonly today: IsoDate;
};

function validRecords(records: readonly VaccinationRecordLike[]): VaccinationRecordLike[] {
  return records.filter((record) => !record.voided);
}

function latestRecord(records: readonly VaccinationRecordLike[]): VaccinationRecordLike | null {
  return validRecords(records).reduce<VaccinationRecordLike | null>(
    (latest, record) => (latest === null || record.appliedOn > latest.appliedOn ? record : latest),
    null,
  );
}

function isEligibleBySex(vaccine: VaccineSchedule, animal: AnimalForVaccine): boolean {
  return vaccine.eligibleSex === null || vaccine.eligibleSex === animal.sex;
}

function status(
  kind: VaccineStatusKind,
  reason: VaccineStatusReason,
  dueOn: IsoDate | null,
  lastAppliedOn: IsoDate | null,
): VaccineStatus {
  return { kind, reason, dueOn, lastAppliedOn };
}

/** Fecha de refuerzo de una vacuna de intervalo (RN-12). `null` si la vacuna no tiene intervalo. */
export function nextDueOnFromInterval(
  appliedOn: IsoDate,
  boosterIntervalDays: number | null,
): IsoDate | null {
  if (boosterIntervalDays === null || boosterIntervalDays <= 0) return null;
  return addDays(appliedOn, boosterIntervalDays);
}

function officialCycleStatus(input: VaccineStatusInput): VaccineStatus {
  const { animal, records, currentCycle, lastClosedCycle } = input;
  const last = latestRecord(records);

  const cycle = currentCycle ?? lastClosedCycle;
  if (cycle === null) {
    return status(
      VACCINE_STATUS.NOT_APPLICABLE,
      VACCINE_STATUS_REASON.NO_CYCLE,
      null,
      last?.appliedOn ?? null,
    );
  }

  // Un animal que no estaba en la finca cuando cerró el ciclo no pudo vacunarse en él:
  // ni el nacido después, ni el comprado después (RN-13, ADR-004).
  if (inFarmSince(animal) > cycle.endsOn) {
    return status(
      VACCINE_STATUS.NOT_APPLICABLE,
      VACCINE_STATUS_REASON.NOT_IN_FARM_DURING_CYCLE,
      null,
      last?.appliedOn ?? null,
    );
  }

  const inCycle = validRecords(records).filter((record) =>
    isWithin(record.appliedOn, cycle.startsOn, cycle.endsOn),
  );
  if (inCycle.length > 0) {
    const applied = inCycle.reduce((latest, record) =>
      record.appliedOn > latest.appliedOn ? record : latest,
    );
    return status(
      VACCINE_STATUS.UP_TO_DATE,
      VACCINE_STATUS_REASON.APPLIED,
      null,
      applied.appliedOn,
    );
  }

  return currentCycle === null
    ? status(
        VACCINE_STATUS.OVERDUE,
        VACCINE_STATUS_REASON.CLOSED_CYCLE,
        cycle.endsOn,
        last?.appliedOn ?? null,
      )
    : status(
        VACCINE_STATUS.PENDING,
        VACCINE_STATUS_REASON.CURRENT_CYCLE,
        cycle.endsOn,
        last?.appliedOn ?? null,
      );
}

function ageWindowStatus(input: VaccineStatusInput): VaccineStatus {
  const { vaccine, animal, today } = input;
  const last = latestRecord(input.records);
  if (last !== null) {
    return status(VACCINE_STATUS.UP_TO_DATE, VACCINE_STATUS_REASON.APPLIED, null, last.appliedOn);
  }

  const days = ageInDays(animal.birthDate, today);
  const dueOn = vaccine.maxAgeDays === null ? null : addDays(animal.birthDate, vaccine.maxAgeDays);

  if (vaccine.minAgeDays !== null && days < vaccine.minAgeDays) {
    return status(
      VACCINE_STATUS.NOT_APPLICABLE,
      VACCINE_STATUS_REASON.BEFORE_AGE_WINDOW,
      vaccine.minAgeDays === null ? null : addDays(animal.birthDate, vaccine.minAgeDays),
      null,
    );
  }

  if (vaccine.maxAgeDays !== null && days > vaccine.maxAgeDays) {
    return status(VACCINE_STATUS.OVERDUE, VACCINE_STATUS_REASON.AFTER_AGE_WINDOW, dueOn, null);
  }

  return status(VACCINE_STATUS.PENDING, VACCINE_STATUS_REASON.IN_AGE_WINDOW, dueOn, null);
}

function intervalStatus(input: VaccineStatusInput): VaccineStatus {
  const { vaccine, animal, today, alertDays } = input;
  const last = latestRecord(input.records);

  if (last === null) {
    const days = ageInDays(animal.birthDate, today);
    if (vaccine.minAgeDays !== null && days < vaccine.minAgeDays) {
      return status(
        VACCINE_STATUS.NOT_APPLICABLE,
        VACCINE_STATUS_REASON.BEFORE_AGE_WINDOW,
        addDays(animal.birthDate, vaccine.minAgeDays),
        null,
      );
    }
    return status(VACCINE_STATUS.PENDING, VACCINE_STATUS_REASON.NO_RECORD, null, null);
  }

  const dueOn =
    last.nextDueOn ?? nextDueOnFromInterval(last.appliedOn, vaccine.boosterIntervalDays);
  if (dueOn === null) {
    return status(VACCINE_STATUS.UP_TO_DATE, VACCINE_STATUS_REASON.APPLIED, null, last.appliedOn);
  }
  if (dueOn < today) {
    return status(
      VACCINE_STATUS.OVERDUE,
      VACCINE_STATUS_REASON.INTERVAL_ELAPSED,
      dueOn,
      last.appliedOn,
    );
  }
  if (dueOn <= addDays(today, alertDays)) {
    return status(
      VACCINE_STATUS.UPCOMING,
      VACCINE_STATUS_REASON.INTERVAL_NEAR,
      dueOn,
      last.appliedOn,
    );
  }
  return status(VACCINE_STATUS.UP_TO_DATE, VACCINE_STATUS_REASON.APPLIED, dueOn, last.appliedOn);
}

/**
 * Ciclo en curso y último ciclo cerrado en una fecha, entre los ciclos que se le pasan: los
 * ciclos oficiales activos que incluyen la vacuna (SAN-06). Un ciclo está en curso desde su
 * inicio hasta su fin, ambos inclusive; está cerrado desde el día siguiente a su fin.
 */
export function cyclesAt<T extends VaccinationCycleLike>(
  cycles: readonly T[],
  date: IsoDate,
): { readonly current: T | null; readonly lastClosed: T | null } {
  let current: T | null = null;
  let lastClosed: T | null = null;
  for (const cycle of cycles) {
    if (isWithin(date, cycle.startsOn, cycle.endsOn)) {
      if (current === null || cycle.startsOn > current.startsOn) current = cycle;
    } else if (cycle.endsOn < date && (lastClosed === null || cycle.endsOn > lastClosed.endsOn)) {
      lastClosed = cycle;
    }
  }
  return { current, lastClosed };
}

/**
 * Estado de una vacuna en un animal según su tipo de programación (RN-13).
 *
 * - `OFFICIAL_CYCLE`: pendiente si no hay aplicación dentro del ciclo en curso; vencida si
 *   faltó la del último ciclo cerrado. No aplica si el animal nació o ingresó a la finca
 *   después del cierre del ciclo.
 * - `AGE_WINDOW`: pendiente dentro de la ventana de edad sin aplicación; vencida al pasar la
 *   edad máxima («fuera de edad»).
 * - `INTERVAL`: vencida si la fecha de refuerzo pasó; próxima si cae dentro de `alertDays`.
 * - `NONE`: nunca genera alerta.
 */
export function vaccineStatus(input: VaccineStatusInput): VaccineStatus {
  const { vaccine } = input;

  if (vaccine.scheduleType === VACCINE_SCHEDULE_TYPE.NONE) {
    return status(VACCINE_STATUS.NOT_APPLICABLE, VACCINE_STATUS_REASON.NO_SCHEDULE, null, null);
  }

  if (!isEligibleBySex(vaccine, input.animal)) {
    return status(
      VACCINE_STATUS.NOT_APPLICABLE,
      VACCINE_STATUS_REASON.NOT_ELIGIBLE_SEX,
      null,
      null,
    );
  }

  if (vaccine.scheduleType === VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE) {
    return officialCycleStatus(input);
  }
  if (vaccine.scheduleType === VACCINE_SCHEDULE_TYPE.AGE_WINDOW) {
    return ageWindowStatus(input);
  }
  return intervalStatus(input);
}

/** Resultado de `canApplyVaccine`. */
export type VaccineApplicationCheck = {
  /** `true` si la aplicación debe rechazarse (RN-26). */
  readonly blocked: boolean;
  /** Código de error cuando está bloqueada. */
  readonly errorCode: ErrorCode | null;
  /** Advertencias no bloqueantes para la respuesta exitosa. */
  readonly warnings: readonly Warning[];
};

/** Entrada de `canApplyVaccine`. */
export type CanApplyVaccineInput = {
  readonly vaccine: VaccineSchedule;
  readonly animal: AnimalForVaccine;
  /** Nombre de la vacuna, para el mensaje. */
  readonly vaccineName: string;
  /** Fecha de aplicación; la edad se evalúa ese día, no hoy. */
  readonly appliedOn: IsoDate;
};

/** Etiquetas de sexo para los mensajes en español. */
const SEX_LABEL = { FEMALE: 'hembras', MALE: 'machos' } as const;

/**
 * ¿Se puede registrar esta vacuna en este animal? (RN-26)
 *
 * El sexo no elegible **bloquea** si la vacuna lo pide (brucelosis en machos, norma ICA).
 * Estar fuera de la ventana de edad solo genera la advertencia
 * `VACCINE_AGE_OUTSIDE_WINDOW`; si el sexo no es elegible pero la vacuna no bloquea, se
 * permite sin advertencia porque el catálogo de 05-api.md no define una para ese caso.
 */
export function canApplyVaccine(input: CanApplyVaccineInput): VaccineApplicationCheck {
  const { vaccine, animal } = input;

  if (!isEligibleBySex(vaccine, animal) && vaccine.blockIneligibleSex) {
    return {
      blocked: true,
      errorCode: 'VACCINE_SEX_BLOCKED',
      warnings: [],
    };
  }

  const days = ageInDays(animal.birthDate, input.appliedOn);
  const tooYoung = vaccine.minAgeDays !== null && days < vaccine.minAgeDays;
  const tooOld = vaccine.maxAgeDays !== null && days > vaccine.maxAgeDays;

  return {
    blocked: false,
    errorCode: null,
    warnings:
      tooYoung || tooOld
        ? [warning('VACCINE_AGE_OUTSIDE_WINDOW', { vaccine: input.vaccineName })]
        : [],
  };
}

/** Mensaje del bloqueo por sexo, con el nombre de la vacuna y el sexo en español. */
export function vaccineSexBlockedParams(
  vaccineName: string,
  sex: Sex,
): Readonly<Record<string, string>> {
  return { vaccine: vaccineName, sex: SEX_LABEL[sex] };
}

// ---------------------------------------------------------------------------------------------
// Vacunación por lote (SAN-03, M6)
// ---------------------------------------------------------------------------------------------

/** Por qué un animal de la selección no se vacuna en un registro por lote. */
export const BULK_VACCINATION_SKIP = {
  /** El animal salió o está archivado. */
  NOT_ACTIVE: 'NOT_ACTIVE',
  /** La vacuna no se aplica a su sexo (RN-26, brucelosis en machos). */
  SEX_BLOCKED: 'SEX_BLOCKED',
  /** La fecha es anterior a su nacimiento o a su ingreso a la finca (RN-14). */
  BEFORE_BIRTH_OR_ENTRY: 'BEFORE_BIRTH_OR_ENTRY',
  /** Vacuna de ciclo oficial que ya tiene en el ciclo de esa fecha. */
  ALREADY_IN_CYCLE: 'ALREADY_IN_CYCLE',
  /** Ya tiene esa vacuna registrada ese mismo día. */
  ALREADY_ON_DATE: 'ALREADY_ON_DATE',
} as const;
export type BulkVaccinationSkip =
  (typeof BULK_VACCINATION_SKIP)[keyof typeof BULK_VACCINATION_SKIP];

/** Entrada de `bulkVaccinationDecision`. */
export type BulkVaccinationDecisionInput = {
  readonly vaccine: VaccineSchedule;
  readonly vaccineName: string;
  readonly animal: AnimalForVaccine & { readonly active: boolean };
  /** Registros de esa vacuna en ese animal, anulados incluidos. */
  readonly records: readonly VaccinationRecordLike[];
  /** Ciclo oficial activo que incluye la vacuna y contiene la fecha; `null` si no hay. */
  readonly cycle: VaccinationCycleLike | null;
  readonly date: IsoDate;
};

/** Resultado de `bulkVaccinationDecision`: se omite con un motivo, o se aplica con advertencias. */
export type BulkVaccinationDecision =
  | { readonly apply: false; readonly skip: BulkVaccinationSkip }
  | { readonly apply: true; readonly warnings: readonly Warning[] };

/**
 * ¿Se registra la vacuna en este animal de la selección? (SAN-03, M6). Se omiten, con su motivo,
 * los que no aplican (inactivos, sexo bloqueado, fecha antes de nacer o de ingresar) y los que ya
 * la tienen (en el ciclo de esa fecha, o ese mismo día). Fuera de la edad recomendada no se omite:
 * se aplica con la advertencia `VACCINE_AGE_OUTSIDE_WINDOW` y la persona puede desmarcarlo.
 */
export function bulkVaccinationDecision(
  input: BulkVaccinationDecisionInput,
): BulkVaccinationDecision {
  const { vaccine, animal, date } = input;
  if (!animal.active) return { apply: false, skip: BULK_VACCINATION_SKIP.NOT_ACTIVE };

  const check = canApplyVaccine({
    vaccine,
    animal,
    vaccineName: input.vaccineName,
    appliedOn: date,
  });
  if (check.blocked) return { apply: false, skip: BULK_VACCINATION_SKIP.SEX_BLOCKED };

  if (date < inFarmSince(animal)) {
    return { apply: false, skip: BULK_VACCINATION_SKIP.BEFORE_BIRTH_OR_ENTRY };
  }

  const valid = validRecords(input.records);
  if (valid.some((record) => record.appliedOn === date)) {
    return { apply: false, skip: BULK_VACCINATION_SKIP.ALREADY_ON_DATE };
  }
  const cycle = input.cycle;
  if (
    vaccine.scheduleType === VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE &&
    cycle !== null &&
    valid.some((record) => isWithin(record.appliedOn, cycle.startsOn, cycle.endsOn))
  ) {
    return { apply: false, skip: BULK_VACCINATION_SKIP.ALREADY_IN_CYCLE };
  }

  return { apply: true, warnings: check.warnings };
}

/**
 * Ciclo oficial que contiene la fecha, entre los que incluyen la vacuna: el de inicio más reciente
 * si se cruzan. Es el `cycle_id` que la API guarda en la vacunación (SAN-06).
 */
export function cycleContaining<T extends VaccinationCycleLike>(
  cycles: readonly T[],
  date: IsoDate,
): T | null {
  let found: T | null = null;
  for (const cycle of cycles) {
    if (!isWithin(date, cycle.startsOn, cycle.endsOn)) continue;
    if (found === null || cycle.startsOn > found.startsOn) found = cycle;
  }
  return found;
}
