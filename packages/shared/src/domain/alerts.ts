/**
 * Alertas de un animal (ANI-06, ANI-07; RN-08, RN-13, RN-22 y 03 §4 «Partos próximos»).
 *
 * El tablero, los listados y la ficha deciden con estas funciones si una alerta está activa
 * (RN-27). Las consultas SQL que filtran por alerta se comprueban contra ellas.
 */

import { addDays, daysBetween, type IsoDate } from '../date.js';
import { ANIMAL_ALERT, type AnimalAlert } from '../enums.js';
import { VACCINE_STATUS, type VaccineStatusKind } from './vaccination.js';

/** Entrada de `isCalvingSoon`. */
export type CalvingSoonInput = {
  /** Fecha estimada de parto de la preñez abierta **confirmada**. */
  readonly expectedCalvingDate: IsoDate;
  /** `Farm.settings.calvingAlertDays`, 30 por defecto. */
  readonly calvingAlertDays: number;
  readonly today: IsoDate;
};

/**
 * ¿El parto está próximo? Fecha estimada ≤ hoy + ventana de alerta (03 §4). Un parto con
 * fecha estimada ya pasada también cuenta: es el más urgente de revisar.
 */
export function isCalvingSoon(input: CalvingSoonInput): boolean {
  return input.expectedCalvingDate <= addDays(input.today, input.calvingAlertDays);
}

/** Entrada de `isServiceUnconfirmedOverdue`. */
export type UnconfirmedServiceInput = {
  /** Fecha de servicio de la preñez abierta **sin confirmar**. */
  readonly serviceDate: IsoDate;
  /** `Farm.settings.unconfirmedServiceAlertDays`, 90 por defecto. */
  readonly alertDays: number;
  readonly today: IsoDate;
};

/** ¿Pasaron **más** de los días de alerta desde el servicio sin diagnóstico? (RN-08) */
export function isServiceUnconfirmedOverdue(input: UnconfirmedServiceInput): boolean {
  return daysBetween(input.serviceDate, input.today) > input.alertDays;
}

/** Preñez abierta, reducida a lo que necesitan las alertas. */
export type OpenPregnancyLike = {
  readonly serviceDate: IsoDate;
  /** `null` si no se ha confirmado. */
  readonly confirmedAt: IsoDate | null;
  readonly expectedCalvingDate: IsoDate;
};

/** Entrada de `animalAlerts`. */
export type AnimalAlertsInput = {
  /** Preñez `PENDING` no anulada; `null` si no tiene. */
  readonly openPregnancy: OpenPregnancyLike | null;
  /** Retiro de medicamento más lejano no anulado; `null` si no hay. */
  readonly withdrawalUntil: IsoDate | null;
  /** Estado de cada vacuna del catálogo en el animal (`vaccineStatus(...).kind`). */
  readonly vaccineStatuses: readonly VaccineStatusKind[];
  readonly calvingAlertDays: number;
  readonly unconfirmedServiceAlertDays: number;
  readonly today: IsoDate;
};

/**
 * Alertas activas del animal, en orden fijo: vacuna vencida, vacuna pendiente o próxima,
 * parto próximo, retiro, servida sin diagnóstico.
 */
export function animalAlerts(input: AnimalAlertsInput): AnimalAlert[] {
  const alerts: AnimalAlert[] = [];

  if (input.vaccineStatuses.includes(VACCINE_STATUS.OVERDUE)) {
    alerts.push(ANIMAL_ALERT.VACCINE_OVERDUE);
  }
  if (
    input.vaccineStatuses.some(
      (kind) => kind === VACCINE_STATUS.PENDING || kind === VACCINE_STATUS.UPCOMING,
    )
  ) {
    alerts.push(ANIMAL_ALERT.VACCINE_DUE);
  }

  const open = input.openPregnancy;
  if (
    open?.confirmedAt != null &&
    isCalvingSoon({
      expectedCalvingDate: open.expectedCalvingDate,
      calvingAlertDays: input.calvingAlertDays,
      today: input.today,
    })
  ) {
    alerts.push(ANIMAL_ALERT.CALVING_SOON);
  }

  if (input.withdrawalUntil !== null && input.withdrawalUntil >= input.today) {
    alerts.push(ANIMAL_ALERT.WITHDRAWAL);
  }

  if (
    open !== null &&
    open.confirmedAt === null &&
    isServiceUnconfirmedOverdue({
      serviceDate: open.serviceDate,
      alertDays: input.unconfirmedServiceAlertDays,
      today: input.today,
    })
  ) {
    alerts.push(ANIMAL_ALERT.UNCONFIRMED_SERVICE);
  }

  return alerts;
}

/** Tratamiento, reducido a lo que necesita el retiro. */
export type WithdrawalRecordLike = {
  readonly withdrawalUntil: IsoDate | null;
  /** `voided_at IS NOT NULL`. Los anulados no cuentan (RN-11). */
  readonly voided: boolean;
};

/**
 * Fin del retiro más lejano entre los tratamientos no anulados; `null` si no hay. Si ya pasó,
 * `derivedTags` y `animalAlerts` no lo cuentan como vigente.
 */
export function withdrawalUntilOf(records: readonly WithdrawalRecordLike[]): IsoDate | null {
  let latest: IsoDate | null = null;
  for (const record of records) {
    if (record.voided || record.withdrawalUntil === null) continue;
    if (latest === null || record.withdrawalUntil > latest) latest = record.withdrawalUntil;
  }
  return latest;
}
