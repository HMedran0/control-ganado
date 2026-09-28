/**
 * Categoría de manejo (exclusiva) y etiquetas derivadas (combinables).
 * RN-06, RN-07, RN-08, RN-25, RN-27 y 08 §2.1. Nada de esto se almacena (RN-16).
 */

import { type IsoDate } from '../date.js';
import {
  DERIVED_TAG,
  MANAGEMENT_CATEGORY,
  PREGNANCY_OUTCOME,
  SEX,
  type DerivedTag,
  type ManagementCategory,
  type PregnancyOutcome,
  type Sex,
} from '../enums.js';
import { ageInMonths } from './age.js';

/** Edad en meses a partir de la cual un macho es toro o macho adulto (08 §2.1). */
export const ADULT_MALE_AGE_MONTHS = 24;

/** Entrada de `managementCategory`. */
export type ManagementCategoryInput = {
  readonly sex: Sex;
  readonly birthDate: IsoDate;
  /** Preñeces con desenlace `CALVED` no anuladas (RN-07). */
  readonly calvingCount: number;
  /** `Farm.settings.weaningAgeMonths`, 7 por defecto (08 §1.2). */
  readonly weaningAgeMonths: number;
  readonly today: IsoDate;
};

/**
 * Categoría de manejo del animal (RN-06). El orden de evaluación es el de la regla:
 * cría por edad, luego hembra con o sin partos, luego macho por edad.
 */
export function managementCategory(input: ManagementCategoryInput): ManagementCategory {
  const months = ageInMonths(input.birthDate, input.today);
  const isCalf = months < input.weaningAgeMonths;

  if (input.sex === SEX.FEMALE) {
    if (isCalf) return MANAGEMENT_CATEGORY.CALF_FEMALE;
    return input.calvingCount >= 1 ? MANAGEMENT_CATEGORY.COW : MANAGEMENT_CATEGORY.HEIFER;
  }

  if (isCalf) return MANAGEMENT_CATEGORY.CALF_MALE;
  return months < ADULT_MALE_AGE_MONTHS
    ? MANAGEMENT_CATEGORY.YOUNG_MALE
    : MANAGEMENT_CATEGORY.ADULT_MALE;
}

/** Entrada de `derivedTags`. */
export type DerivedTagsInput = {
  readonly category: ManagementCategory;
  /** Preñez `PENDING` no anulada con `confirmedAt` (RN-08). */
  readonly hasOpenConfirmedPregnancy: boolean;
  /** Preñez `PENDING` no anulada sin confirmar (RN-08). */
  readonly hasOpenUnconfirmedPregnancy: boolean;
  /** Preñeces con desenlace `CALVED` no anuladas (RN-07). */
  readonly calvingCount: number;
  /** Fecha del último parto; `null` si no ha parido. */
  readonly lastCalvingDate: IsoDate | null;
  /** `TreatmentRecord.withdrawalUntil` más lejana vigente; `null` si no hay retiro. */
  readonly withdrawalUntil: IsoDate | null;
  readonly weaningAgeMonths: number;
  readonly today: IsoDate;
};

/**
 * Etiquetas derivadas del animal, en orden fijo: `SERVED`, `PREGNANT`, `CALVED`, `DRY`,
 * `WITHDRAWAL`.
 *
 * `DRY` (Horra, RN-25): vaca sin preñez abierta cuyo último parto fue hace al menos la edad
 * de destete, es decir, sin cría al pie. Si una vaca no tuviera fecha de último parto
 * registrada no se marca horra, porque no se puede saber si tiene cría al pie.
 */
export function derivedTags(input: DerivedTagsInput): DerivedTag[] {
  const tags: DerivedTag[] = [];

  if (input.hasOpenUnconfirmedPregnancy) tags.push(DERIVED_TAG.SERVED);
  if (input.hasOpenConfirmedPregnancy) tags.push(DERIVED_TAG.PREGNANT);
  if (input.calvingCount >= 1) tags.push(DERIVED_TAG.CALVED);

  const isCow = input.category === MANAGEMENT_CATEGORY.COW;
  const hasOpenPregnancy = input.hasOpenConfirmedPregnancy || input.hasOpenUnconfirmedPregnancy;
  if (isCow && !hasOpenPregnancy && input.lastCalvingDate !== null) {
    const monthsSinceCalving = ageInMonths(input.lastCalvingDate, input.today);
    if (monthsSinceCalving >= input.weaningAgeMonths) tags.push(DERIVED_TAG.DRY);
  }

  if (input.withdrawalUntil !== null && input.withdrawalUntil >= input.today) {
    tags.push(DERIVED_TAG.WITHDRAWAL);
  }

  return tags;
}

/** Preñez, reducida a lo que necesita la clasificación. */
export type PregnancyFactsInput = {
  readonly outcome: PregnancyOutcome;
  /** Fecha del parto, aborto o diagnóstico negativo. */
  readonly outcomeDate: IsoDate | null;
  readonly serviceDate: IsoDate;
  readonly confirmedAt: IsoDate | null;
  readonly expectedCalvingDate: IsoDate;
  /** `voided_at IS NOT NULL`. Las anuladas no cuentan (RN-11). */
  readonly voided: boolean;
};

/** Hechos reproductivos de una hembra, de donde salen la categoría y las etiquetas. */
export type PregnancyFacts = {
  /**
   * Partos: preñeces `CALVED` no anuladas (RN-07) más los partos anteriores al sistema que
   * llegaron por importación sin fecha (`imported_prior_calvings`, RN-29).
   */
  readonly calvingCount: number;
  /** Fecha más reciente de esos partos; `null` si no hay ninguno con fecha. */
  readonly lastCalvingDate: IsoDate | null;
  /** Preñez `PENDING` no anulada (RN-03: a lo sumo una). */
  readonly openPregnancy: {
    readonly serviceDate: IsoDate;
    readonly confirmedAt: IsoDate | null;
    readonly expectedCalvingDate: IsoDate;
  } | null;
};

/**
 * Resume las preñeces de una hembra para `managementCategory`, `derivedTags` y las alertas.
 * Si por un error de datos hubiera más de una abierta, cuenta la de servicio más reciente.
 *
 * `importedPriorCalvings` son los partos anteriores que trajo la importación sin fecha: suman
 * al número de partos (Vaca, Parida) pero no a la fecha del último parto (Horra).
 */
export function summarizePregnancies(
  pregnancies: readonly PregnancyFactsInput[],
  importedPriorCalvings = 0,
): PregnancyFacts {
  let calvingCount = importedPriorCalvings;
  let lastCalvingDate: IsoDate | null = null;
  let openPregnancy: PregnancyFacts['openPregnancy'] = null;

  for (const pregnancy of pregnancies) {
    if (pregnancy.voided) continue;
    if (pregnancy.outcome === PREGNANCY_OUTCOME.CALVED) {
      calvingCount += 1;
      const date = pregnancy.outcomeDate;
      if (date !== null && (lastCalvingDate === null || date > lastCalvingDate)) {
        lastCalvingDate = date;
      }
    } else if (
      pregnancy.outcome === PREGNANCY_OUTCOME.PENDING &&
      (openPregnancy === null || pregnancy.serviceDate > openPregnancy.serviceDate)
    ) {
      openPregnancy = {
        serviceDate: pregnancy.serviceDate,
        confirmedAt: pregnancy.confirmedAt,
        expectedCalvingDate: pregnancy.expectedCalvingDate,
      };
    }
  }

  return { calvingCount, lastCalvingDate, openPregnancy };
}
