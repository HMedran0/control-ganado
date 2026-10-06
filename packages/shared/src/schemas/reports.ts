import { z } from 'zod';

import type { IsoDate } from '../date.js';
import type { VaccineStatusKind } from '../domain/vaccination.js';
import {
  EXIT_TYPE,
  type ExitType,
  type IcaAgeGroup,
  type ManagementCategory,
  type Sex,
} from '../enums.js';
import type { AnimalRef } from './animals.js';
import { isoDateSchema } from './catalogs.js';

/**
 * Reportes estándar (RPT-02) y gráficas (RPT-03), M8b: consultas y respuestas de
 * `GET /reports/*`. Cada reporte se descarga en Excel con los mismos filtros en
 * `GET /reports/:name/export?format=xlsx` (05).
 */

// ---------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------

const period = {
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
};
const periodOrder = (value: { from?: string | undefined; to?: string | undefined }) =>
  value.from === undefined || value.to === undefined || value.from <= value.to;
const periodError = { path: ['to'], message: 'La fecha final no puede ser anterior a la inicial.' };

/** Período: sin fechas, del 1.º de enero a hoy (como el de nacimientos). */
export const reportPeriodQuerySchema = z.object(period).refine(periodOrder, periodError);
export type ReportPeriodQuery = z.infer<typeof reportPeriodQuerySchema>;

export const vaccinationsReportQuerySchema = z
  .object({ ...period, vaccineId: z.uuid({ message: 'La vacuna no es válida.' }).optional() })
  .refine(periodOrder, periodError);
export type VaccinationsReportQuery = z.infer<typeof vaccinationsReportQuerySchema>;

export const exitsReportQuerySchema = z
  .object({
    ...period,
    type: z
      .enum(Object.values(EXIT_TYPE) as [ExitType, ...ExitType[]], {
        message: 'El tipo de salida no es válido.',
      })
      .optional(),
  })
  .refine(periodOrder, periodError);
export type ExitsReportQuery = z.infer<typeof exitsReportQuerySchema>;

export const cycleProgressReportQuerySchema = z.object({
  cycleId: z.uuid({ message: 'Elige un ciclo de vacunación.' }),
});
export type CycleProgressReportQuery = z.infer<typeof cycleProgressReportQuerySchema>;

/** `GET /reports/:name/export?format=xlsx`: por ahora solo Excel (RPT-02 CA1). */
export const reportExportFormatSchema = z.object({
  format: z.literal('xlsx', { message: 'El formato debe ser xlsx.' }).default('xlsx'),
});

// ---------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------

type BySex = { readonly males: number; readonly females: number; readonly total: number };

/** Inventario de los animales activos (RPT-02). Cada cifra coincide con su listado. */
export type InventoryReport = {
  readonly today: IsoDate;
  readonly total: number;
  readonly males: number;
  readonly females: number;
  /** Las seis categorías de manejo, en orden, aunque alguna esté en cero. */
  readonly byCategory: readonly ({ readonly category: ManagementCategory } & BySex)[];
  readonly byBreed: readonly ({ readonly breedId: string; readonly name: string } & BySex)[];
  /** `lotId` nulo: los que no tienen lote. */
  readonly byLot: readonly ({
    readonly lotId: string | null;
    readonly name: string | null;
  } & BySex)[];
};

/** Inventario por grupos de edad en formato ICA (08 §2.2) [Validar el formato con la finca]. */
export type IcaInventoryReport = {
  readonly today: IsoDate;
  readonly farm: {
    readonly name: string;
    readonly municipality: string | null;
    readonly department: string | null;
    readonly icaPremiseCode: string | null;
  };
  /** Por sexo, en el orden de `ICA_GROUPS_BY_SEX`, con los grupos en cero. */
  readonly groups: readonly {
    readonly sex: Sex;
    readonly group: IcaAgeGroup;
    readonly count: number;
  }[];
  readonly totals: BySex;
};

export type VaccinationsReport = {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly byVaccine: readonly {
    readonly vaccineId: string;
    readonly name: string;
    readonly count: number;
  }[];
  readonly items: readonly {
    readonly id: string;
    readonly appliedOn: IsoDate;
    readonly animal: AnimalRef;
    readonly vaccine: { readonly id: string; readonly name: string };
    readonly dose: string | null;
    readonly cycle: string | null;
    readonly ruvNumber: string | null;
    readonly responsible: string | null;
  }[];
};

/** Animales activos con vacunas vencidas, pendientes o próximas (lo mismo que Alertas). */
export type VaccinationPendingReport = {
  readonly today: IsoDate;
  /** Animales distintos: cada uno cuenta una vez aunque le falten varias vacunas. */
  readonly animals: number;
  readonly items: readonly {
    readonly animal: AnimalRef;
    readonly category: ManagementCategory;
    readonly lot: string | null;
    readonly vaccine: { readonly id: string; readonly name: string };
    readonly status: Extract<VaccineStatusKind, 'OVERDUE' | 'PENDING' | 'UPCOMING'>;
    readonly dueOn: IsoDate | null;
  }[];
};

/** Preñadas con el parto dentro de la ventana de la finca o ya vencido (RPT-02, CU-03). */
export type CalvingsUpcomingReport = {
  readonly today: IsoDate;
  readonly windowDays: number;
  readonly items: readonly {
    readonly pregnancyId: string;
    readonly dam: AnimalRef;
    readonly lot: string | null;
    readonly serviceDate: IsoDate;
    readonly expectedCalvingDate: IsoDate;
    /** Días que faltan; negativo si ya debía parir. */
    readonly daysToCalving: number;
    readonly sire: string | null;
  }[];
};

/** Salidas de la finca en un período. Precio y comprador, solo el ADMIN (RN-20). */
export type ExitsReport = {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly byType: readonly { readonly type: ExitType; readonly count: number }[];
  readonly items: readonly {
    readonly animal: AnimalRef & { readonly sex: Sex };
    readonly exitType: ExitType;
    readonly exitDate: IsoDate;
    readonly reason: string | null;
    /** Solo para el ADMIN: la clave no existe para los demás. */
    readonly salePrice?: string | null;
    readonly buyer?: string | null;
  }[];
};

/** Gráficas de Reportes (RPT-03). */
export type ChartsReport = {
  readonly today: IsoDate;
  /** Activos al terminar cada uno de los últimos 12 meses (el actual, hoy). */
  readonly inventoryByMonth: readonly {
    readonly month: string;
    readonly on: IsoDate;
    readonly males: number;
    readonly females: number;
    readonly total: number;
  }[];
  /** Nacidos en la finca cada mes de los últimos 12, con el criterio del reporte de nacimientos. */
  readonly birthsByMonth: readonly {
    readonly month: string;
    readonly males: number;
    readonly females: number;
  }[];
  readonly byCategory: readonly {
    readonly category: ManagementCategory;
    readonly count: number;
  }[];
};
