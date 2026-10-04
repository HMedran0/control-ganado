/**
 * Tratamientos y períodos de retiro (SAN-05, RN-22; 03 §2.5).
 *
 * Un tratamiento tiene dos retiros: el de **carne** (no vender ni sacrificar para consumo) y el de
 * **leche** (no vender la leche, M9b). Decisión de M6:
 *
 * - «En retiro» y el filtro del listado usan el **más lejano** de los dos (`withdrawal_until`,
 *   la columna que guarda la API y que ya usaba la clasificación);
 * - la ficha muestra los dos: «Carne hasta X · Leche hasta Y»;
 * - RN-22 (vender o sacrificar) usa solo el de **carne**;
 * - el de leche lo usa el control de leche (LEC-01 CA4, M9b).
 */

import { addDays, type IsoDate } from '../date.js';

/** Datos del tratamiento que fijan sus retiros. */
export type TreatmentWithdrawalInput = {
  readonly startedOn: IsoDate;
  /** Días de tratamiento: el retiro empieza a contar al terminar. */
  readonly durationDays: number;
  readonly withdrawalMeatDays: number;
  readonly withdrawalMilkDays: number;
};

/** Fines de retiro de un tratamiento. `null` si ese retiro es de 0 días. */
export type TreatmentWithdrawal = {
  readonly meatUntil: IsoDate | null;
  readonly milkUntil: IsoDate | null;
  /** El más lejano de los dos: `withdrawal_until` en la base (03 §2.5). */
  readonly until: IsoDate | null;
};

function endOf(input: TreatmentWithdrawalInput, days: number): IsoDate | null {
  return days > 0 ? addDays(input.startedOn, input.durationDays + days) : null;
}

/**
 * Retiros de un tratamiento: inicio + días de tratamiento + días de retiro (03 §2.5). Un
 * medicamento sin retiro de carne ni de leche no deja al animal «En retiro».
 */
export function treatmentWithdrawal(input: TreatmentWithdrawalInput): TreatmentWithdrawal {
  const meatUntil = endOf(input, input.withdrawalMeatDays);
  const milkUntil = endOf(input, input.withdrawalMilkDays);
  const until =
    meatUntil === null
      ? milkUntil
      : milkUntil === null || meatUntil >= milkUntil
        ? meatUntil
        : milkUntil;
  return { meatUntil, milkUntil, until };
}

/** Tratamiento, reducido a lo que necesitan los retiros del animal. */
export type TreatmentLike = TreatmentWithdrawalInput & {
  /** `voided_at IS NOT NULL`. Los anulados no cuentan (RN-11). */
  readonly voided: boolean;
};

/** Retiros más lejanos del animal entre sus tratamientos no anulados. */
export type AnimalWithdrawals = {
  readonly meatUntil: IsoDate | null;
  readonly milkUntil: IsoDate | null;
  readonly until: IsoDate | null;
};

function later(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/**
 * Retiros del animal: el fin más lejano de cada tipo entre los tratamientos no anulados. Si ya
 * pasaron, la ficha no los muestra como vigentes (`derivedTags` y `animalAlerts` comparan con hoy).
 */
export function animalWithdrawals(treatments: readonly TreatmentLike[]): AnimalWithdrawals {
  let meatUntil: IsoDate | null = null;
  let milkUntil: IsoDate | null = null;
  for (const treatment of treatments) {
    if (treatment.voided) continue;
    const withdrawal = treatmentWithdrawal(treatment);
    meatUntil = later(meatUntil, withdrawal.meatUntil);
    milkUntil = later(milkUntil, withdrawal.milkUntil);
  }
  return { meatUntil, milkUntil, until: later(meatUntil, milkUntil) };
}

/** ¿El retiro sigue vigente hoy? El último día de retiro cuenta. */
export function isWithdrawalActive(until: IsoDate | null, today: IsoDate): boolean {
  return until !== null && until >= today;
}
