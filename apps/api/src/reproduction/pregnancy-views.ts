import {
  PREGNANCY_OUTCOME,
  gestationDaysElapsed,
  type IsoDate,
  type PregnancyView,
} from '@hato/shared';

import type { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate, fromPrismaDateOrNull } from '../infra/date-mapper.js';

const ref = { select: { id: true, code: true, name: true } } as const;

/** Lo que se lee de una preñez para armar su vista. */
export const pregnancyInclude = {
  dam: ref,
  sire: ref,
  // Las crías archivadas (registros duplicados) no se muestran como hijas del parto.
  calves: { where: { deletedAt: null }, orderBy: { code: 'asc' }, ...ref },
} as const satisfies Prisma.PregnancyInclude;

export type PregnancyRow = Prisma.PregnancyGetPayload<{ include: typeof pregnancyInclude }>;

/** Vista de una preñez (REP-05). `today` da los días de gestación de la abierta. */
export function toPregnancyView(row: PregnancyRow, today: IsoDate): PregnancyView {
  const open = row.outcome === PREGNANCY_OUTCOME.PENDING && row.voidedAt === null;
  const serviceDate = fromPrismaDate(row.serviceDate);
  return {
    id: row.id,
    dam: row.dam,
    serviceDate,
    serviceDateEstimated: row.serviceDateEstimated,
    method: row.method,
    sire: row.sire,
    sireExternalRef: row.sireExternalRef,
    responsible: row.responsible,
    confirmedAt: fromPrismaDateOrNull(row.confirmedAt),
    diagnosisResponsible: row.diagnosisResponsible,
    diagnosisNotes: row.diagnosisNotes,
    expectedCalvingDate: fromPrismaDate(row.expectedCalvingDate),
    expectedCalvingManual: row.expectedCalvingManual,
    outcome: row.outcome,
    outcomeDate: fromPrismaDateOrNull(row.outcomeDate),
    calvingType: row.calvingType,
    stillbornCount: row.stillbornCount,
    isImported: row.isImported,
    notes: row.notes,
    gestationDays: open ? gestationDaysElapsed(serviceDate, today) : null,
    calves: row.calves,
    voided:
      row.voidedAt === null ? null : { at: row.voidedAt.toISOString(), reason: row.voidReason },
    version: row.version,
  };
}

/** Lo auditable de una preñez: sin vistas anidadas, con las fechas como `YYYY-MM-DD`. */
export function pregnancySnapshot(row: {
  serviceDate: Date;
  serviceDateEstimated: boolean;
  method: string;
  sireId: string | null;
  sireExternalRef: string | null;
  confirmedAt: Date | null;
  diagnosisResponsible: string | null;
  diagnosisNotes: string | null;
  expectedCalvingDate: Date;
  expectedCalvingManual: boolean;
  outcome: string;
  outcomeDate: Date | null;
  calvingType: string | null;
  stillbornCount: number;
  responsible: string | null;
  notes: string | null;
}): Record<string, string | number | boolean | null> {
  return {
    serviceDate: fromPrismaDate(row.serviceDate),
    serviceDateEstimated: row.serviceDateEstimated,
    method: row.method,
    sireId: row.sireId,
    sireExternalRef: row.sireExternalRef,
    confirmedAt: fromPrismaDateOrNull(row.confirmedAt),
    diagnosisResponsible: row.diagnosisResponsible,
    diagnosisNotes: row.diagnosisNotes,
    expectedCalvingDate: fromPrismaDate(row.expectedCalvingDate),
    expectedCalvingManual: row.expectedCalvingManual,
    outcome: row.outcome,
    outcomeDate: fromPrismaDateOrNull(row.outcomeDate),
    calvingType: row.calvingType,
    stillbornCount: row.stillbornCount,
    responsible: row.responsible,
    notes: row.notes,
  };
}
