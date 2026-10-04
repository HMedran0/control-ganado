import {
  ANIMAL_STATUS,
  animalAlerts,
  animalStatus,
  ageInMonths,
  derivedTags,
  gainFromMilli,
  managementCategory,
  weightAlerts,
  type AnimalAlert,
  type AnimalStatus,
  type DerivedTag,
  type ExitType,
  type IsoDate,
  type ManagementCategory,
  type PregnancyFacts,
  type Sex,
  type VaccineStatusView,
  type WeightRecordLike,
  type WeightSummary,
} from '@hato/shared';

import type { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate } from '../infra/date-mapper.js';

import type { FarmContext } from './farm-context.service.js';

/**
 * Lo que se **muestra** de un animal —categoría, etiquetas, alertas— se calcula siempre con las
 * funciones de `@hato/shared` (RN-27), venga la fila del SQL del listado o de los registros de
 * la ficha. El SQL de `classification.sql.ts` solo filtra y cuenta.
 */

/** Hechos de un animal de los que sale su clasificación. */
export type AnimalFacts = PregnancyFacts & {
  readonly sex: Sex;
  readonly birthDate: IsoDate;
  readonly withdrawalUntil: IsoDate | null;
  readonly archived: boolean;
  readonly exitType: ExitType | null;
};

export type DerivedView = {
  readonly ageMonths: number;
  readonly category: ManagementCategory;
  readonly derivedTags: DerivedTag[];
  readonly status: AnimalStatus;
  readonly alerts: AnimalAlert[];
  /** Parto estimado, solo con la preñez abierta confirmada (la columna del listado, 06 §5.2). */
  readonly expectedCalvingDate: IsoDate | null;
  /** Ganancias y alertas de peso (PES-05); `null` si el animal no está activo. */
  readonly weight: WeightSummary | null;
};

/** Pesaje de la base, reducido a lo que necesitan la ganancia y las alertas (ADR-015). */
export function toWeightLike(row: {
  readonly id: string;
  readonly weighedOn: Date;
  readonly weightKg: Prisma.Decimal | number | string;
  readonly isBirthWeight: boolean;
  readonly voidedAt: Date | null;
}): WeightRecordLike {
  return {
    id: row.id,
    weighedOn: fromPrismaDate(row.weighedOn),
    weightKg: Number(row.weightKg),
    isBirthWeight: row.isBirthWeight,
    voided: row.voidedAt !== null,
  };
}

/** Lo que se lee de cada pesaje para `toWeightLike`. */
export const WEIGHT_LIKE_SELECT = {
  id: true,
  animalId: true,
  weighedOn: true,
  weightKg: true,
  isBirthWeight: true,
  voidedAt: true,
} as const;

/** Resumen de peso de un animal de la categoría dada (PES-05), con las funciones de shared. */
export function weightSummaryOf(
  records: readonly WeightRecordLike[],
  category: ManagementCategory,
  context: FarmContext,
): WeightSummary {
  const { settings, today } = context;
  const result = weightAlerts({ records, category, settings, today });
  const toKg = (milli: number | null) => (milli === null ? null : gainFromMilli(milli));
  return {
    gains: {
      lastTwo: toKg(result.gains.lastTwoMilli),
      last90Days: toKg(result.gains.last90DaysMilli),
      sinceBirth: toKg(result.gains.sinceBirthMilli),
    },
    gainThreshold: settings.weightGainAlertKgPerDay[category] ?? null,
    lowGain: result.lowGain,
    weightLoss: result.weightLoss,
    lossPercent: result.lossPercent,
  };
}

/**
 * Categoría, etiquetas, estado y alertas de un animal. Un animal que no está activo no tiene
 * alertas: ni el listado ni el tablero lo cuentan (03 §4, «Animales activos»).
 */
export function deriveView(
  facts: AnimalFacts,
  context: FarmContext,
  vaccineStatuses: readonly VaccineStatusView[],
  weights: readonly WeightRecordLike[],
): DerivedView {
  const { today, settings } = context;
  const category = managementCategory({
    sex: facts.sex,
    birthDate: facts.birthDate,
    calvingCount: facts.calvingCount,
    weaningAgeMonths: settings.weaningAgeMonths,
    today,
  });
  const open = facts.openPregnancy;
  const tags = derivedTags({
    category,
    hasOpenConfirmedPregnancy: open !== null && open.confirmedAt !== null,
    hasOpenUnconfirmedPregnancy: open !== null && open.confirmedAt === null,
    calvingCount: facts.calvingCount,
    lastCalvingDate: facts.lastCalvingDate,
    withdrawalUntil: facts.withdrawalUntil,
    weaningAgeMonths: settings.weaningAgeMonths,
    today,
  });
  const status = animalStatus({ archived: facts.archived, exitType: facts.exitType });
  const weight =
    status === ANIMAL_STATUS.ACTIVE ? weightSummaryOf(weights, category, context) : null;
  const alerts =
    status === ANIMAL_STATUS.ACTIVE
      ? animalAlerts({
          openPregnancy: open,
          withdrawalUntil: facts.withdrawalUntil,
          vaccineStatuses: vaccineStatuses.map((vaccine) => vaccine.status),
          calvingAlertDays: settings.calvingAlertDays,
          unconfirmedServiceAlertDays: settings.unconfirmedServiceAlertDays,
          overdueCalvingAlertDays: settings.overdueCalvingAlertDays,
          weight: {
            lowGain: weight?.lowGain ?? false,
            weightLoss: weight?.weightLoss ?? false,
          },
          today,
        })
      : [];

  return {
    ageMonths: ageInMonths(facts.birthDate, today),
    category,
    derivedTags: tags,
    status,
    alerts,
    expectedCalvingDate:
      open !== null && open.confirmedAt !== null ? open.expectedCalvingDate : null,
    weight,
  };
}
