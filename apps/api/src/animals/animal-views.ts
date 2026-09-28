import {
  ANIMAL_STATUS,
  animalAlerts,
  animalStatus,
  ageInMonths,
  derivedTags,
  managementCategory,
  type AnimalAlert,
  type AnimalStatus,
  type DerivedTag,
  type ExitType,
  type IsoDate,
  type ManagementCategory,
  type PregnancyFacts,
  type Sex,
  type VaccineStatusView,
} from '@hato/shared';

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
};

/**
 * Categoría, etiquetas, estado y alertas de un animal. Un animal que no está activo no tiene
 * alertas: ni el listado ni el tablero lo cuentan (03 §4, «Animales activos»).
 */
export function deriveView(
  facts: AnimalFacts,
  context: FarmContext,
  vaccineStatuses: readonly VaccineStatusView[],
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
  const alerts =
    status === ANIMAL_STATUS.ACTIVE
      ? animalAlerts({
          openPregnancy: open,
          withdrawalUntil: facts.withdrawalUntil,
          vaccineStatuses: vaccineStatuses.map((vaccine) => vaccine.status),
          calvingAlertDays: settings.calvingAlertDays,
          unconfirmedServiceAlertDays: settings.unconfirmedServiceAlertDays,
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
  };
}
