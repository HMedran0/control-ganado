import {
  AUDIT_ACTION,
  PREGNANCY_OUTCOME,
  expectedCalvingDate,
  expectedCalvingRecalculatedWarning,
  type Warning,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { audit, type Tx } from '../common/persistence.js';
import type { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';

/**
 * Recalcula el parto estimado de las preñeces abiertas cuando cambia la gestación que les aplica
 * (RN-04, decisión de M5 que reemplaza el «se congela» de 03 §2.4):
 *
 * - cambió la gestación de una raza → las preñeces de las madres de esa raza;
 * - cambió la gestación de la finca → las de las madres cuya raza no tiene gestación propia;
 * - cambió la raza de una madre → sus preñeces.
 *
 * Solo las abiertas (`PENDING`) y no anuladas. Las que alguien corrigió a mano
 * (`expected_calving_manual`) no se tocan: se cuentan para el aviso. Cada cambio queda en la
 * auditoría de la preñez.
 */
export type RecalculationTarget =
  | { readonly kind: 'BREED'; readonly breedId: string }
  | { readonly kind: 'FARM_DEFAULT' }
  | { readonly kind: 'DAM'; readonly damId: string };

export type RecalculationResult = {
  readonly recalculated: number;
  readonly skippedManual: number;
};

export async function recalculateOpenPregnancies(
  tx: Tx,
  scope: FarmScope,
  input: {
    readonly target: RecalculationTarget;
    /** `Farm.settings.gestationDays` vigente después del cambio. */
    readonly farmGestationDays: number;
    readonly at: Date;
  },
): Promise<RecalculationResult> {
  const dam: Prisma.AnimalWhereInput =
    input.target.kind === 'BREED'
      ? { breedId: input.target.breedId }
      : input.target.kind === 'FARM_DEFAULT'
        ? { breed: { gestationDays: null } }
        : { id: input.target.damId };

  const open = await tx.pregnancy.findMany({
    where: { farmId: scope.farmId, outcome: PREGNANCY_OUTCOME.PENDING, voidedAt: null, dam },
    select: {
      id: true,
      serviceDate: true,
      expectedCalvingDate: true,
      expectedCalvingManual: true,
      dam: { select: { breed: { select: { gestationDays: true } } } },
    },
  });

  let recalculated = 0;
  let skippedManual = 0;
  for (const pregnancy of open) {
    const before = fromPrismaDate(pregnancy.expectedCalvingDate);
    const after = expectedCalvingDate({
      serviceDate: fromPrismaDate(pregnancy.serviceDate),
      breedGestationDays: pregnancy.dam.breed.gestationDays,
      farmGestationDays: input.farmGestationDays,
    });
    if (after === before) continue;
    if (pregnancy.expectedCalvingManual) {
      skippedManual += 1;
      continue;
    }
    await tx.pregnancy.update({
      where: { id: pregnancy.id },
      data: { expectedCalvingDate: toPrismaDate(after), version: { increment: 1 } },
    });
    await audit(tx, {
      scope,
      entity: 'Pregnancy',
      entityId: pregnancy.id,
      action: AUDIT_ACTION.UPDATE,
      at: input.at,
      diff: {
        changed: ['expectedCalvingDate'],
        before: { expectedCalvingDate: before },
        after: { expectedCalvingDate: after },
        reason: input.target.kind,
      },
    });
    recalculated += 1;
  }
  return { recalculated, skippedManual };
}

/** La advertencia para la respuesta, o ninguna si no hubo nada que recalcular ni que omitir. */
export function recalculationWarnings(result: RecalculationResult): Warning[] {
  if (result.recalculated === 0 && result.skippedManual === 0) return [];
  return [expectedCalvingRecalculatedWarning(result.recalculated, result.skippedManual)];
}
