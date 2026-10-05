/**
 * Esquemas de las finanzas (ECO-01 a ECO-06; 05-api.md «Finanzas», M7). Todo es solo del ADMIN
 * (RN-20): la API responde 403 a los demás roles en cada una de estas rutas.
 *
 * Toda creación acepta el `id` del cliente; lo editable lleva `version`, y anular acepta
 * `Idempotency-Key` (ADR-012). Los montos viajan como cadena con dos decimales.
 */

import { z } from 'zod';

import type { IsoDate } from '../date.js';
import type { AnimalInvestment, AnimalResult } from '../domain/finance.js';
import {
  ALLOCATION_METHOD,
  EXPENSE_TYPE,
  VALUATION_METHOD,
  type AllocationMethod,
  type ExpenseType,
  type ManagementCategory,
  type ValuationMethod,
} from '../enums.js';
import type { MoneyString } from '../money.js';
import { positiveMoneySchema, type AnimalRef } from './animals.js';
import { isoDateSchema, versionSchema } from './catalogs.js';
import { clientIdSchema } from './offline.js';

const uuidSchema = z.uuid({ message: 'El identificador no es válido.' });

/** Máximo de animales elegidos a mano para repartir un gasto (el listado filtrado entero). */
export const MAX_EXPENSE_ANIMALS = 5000;

/** Tipos que se registran como gasto suelto: la compra va en la ficha del animal (ANI-01). */
export const EXPENSE_FORM_TYPES = Object.values(EXPENSE_TYPE).filter(
  (type) => type !== EXPENSE_TYPE.PURCHASE,
);

const expenseTypeSchema = z.enum(Object.values(EXPENSE_TYPE) as [ExpenseType, ...ExpenseType[]], {
  message: 'Elige el tipo de gasto.',
});

const descriptionSchema = z
  .string({ message: 'Describe el gasto.' })
  .trim()
  .min(3, { message: 'Describe el gasto (mínimo 3 caracteres).' })
  .max(200, { message: 'Máximo 200 caracteres.' });

/**
 * A quién se carga el gasto (ECO-01, ECO-02):
 * - `DIRECT` con `animalId`: todo a un animal.
 * - `EQUAL` o `BY_WEIGHT` con `lotId` (los animales activos del lote al guardar) o `animalIds`
 *   (la selección del listado, también «todo lo filtrado»).
 * - `GENERAL`: gasto de la finca, sin animales.
 */
export const expenseAllocationSchema = z
  .object({
    method: z.enum(Object.values(ALLOCATION_METHOD) as [AllocationMethod, ...AllocationMethod[]], {
      message: 'Elige cómo se carga el gasto.',
    }),
    animalId: uuidSchema.optional(),
    lotId: uuidSchema.optional(),
    animalIds: z
      .array(uuidSchema)
      .max(MAX_EXPENSE_ANIMALS, { message: `Máximo ${MAX_EXPENSE_ANIMALS} animales.` })
      .optional(),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    const targets = [value.animalId, value.lotId, value.animalIds].filter(
      (target) => target !== undefined,
    ).length;
    switch (value.method) {
      case ALLOCATION_METHOD.DIRECT:
        if (value.animalId === undefined) issue('animalId', 'Elige el animal.');
        if (targets > 1) issue('method', 'Un gasto directo es de un solo animal.');
        break;
      case ALLOCATION_METHOD.GENERAL:
        if (targets > 0) issue('method', 'Un gasto general no se carga a animales.');
        break;
      default:
        if (value.animalId !== undefined)
          issue('animalId', 'Para repartir, elige un lote o animales.');
        if (value.lotId === undefined && value.animalIds === undefined) {
          issue('lotId', 'Elige el lote o los animales.');
        }
        if (value.lotId !== undefined && value.animalIds !== undefined) {
          issue('lotId', 'Elige el lote o los animales, no ambos.');
        }
        if (value.animalIds?.length === 0) issue('animalIds', 'Selecciona al menos un animal.');
    }
  });
export type ExpenseAllocationInput = z.infer<typeof expenseAllocationSchema>;

/** `POST /expenses` (ECO-01, ECO-02). Con `dryRun`, devuelve el reparto sin guardar. */
export const createExpenseSchema = z.object({
  id: clientIdSchema.optional(),
  type: expenseTypeSchema,
  date: isoDateSchema,
  amount: positiveMoneySchema,
  description: descriptionSchema,
  allocation: expenseAllocationSchema,
  dryRun: z.boolean().optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/**
 * `PATCH /expenses/:id`. Lo que no llega no cambia. Sin `allocation`, los mismos animales: si
 * cambió el monto, se reparte otra vez entre ellos con el mismo método (ADR-016). Corregir solo la
 * descripción, el tipo o la fecha no toca ninguna asignación.
 */
export const updateExpenseSchema = z.object({
  version: versionSchema,
  type: expenseTypeSchema.optional(),
  date: isoDateSchema.optional(),
  amount: positiveMoneySchema.optional(),
  description: descriptionSchema.optional(),
  allocation: expenseAllocationSchema.optional(),
});
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

/** Filtros de `GET /expenses`. */
export const listExpensesQuerySchema = z.object({
  type: expenseTypeSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  animalId: uuidSchema.optional(),
  lotId: uuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
  /** `true` incluye los anulados (marcados); por defecto, solo los vigentes. */
  voided: z.enum(['true', 'false']).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

/** Una asignación vigente del gasto. */
export type ExpenseAllocationView = {
  readonly animal: AnimalRef;
  readonly amount: MoneyString;
};

/** Un gasto. Las asignaciones solo vienen en el detalle y en la simulación. */
export type ExpenseView = {
  readonly id: string;
  readonly type: ExpenseType;
  readonly date: IsoDate;
  readonly amount: MoneyString;
  readonly description: string;
  readonly method: AllocationMethod;
  readonly lot: { readonly id: string; readonly name: string } | null;
  /** Animales con asignación vigente (0 en un gasto general o anulado). */
  readonly animalCount: number;
  /** El animal de un gasto directo. */
  readonly animal: AnimalRef | null;
  /** Gasto del costo de un tratamiento (SAN-05): sus animales no se cambian desde Finanzas. */
  readonly treatmentId: string | null;
  readonly voided: boolean;
  readonly voidReason: string | null;
  readonly version: number;
  readonly createdBy: string;
};

export type ExpenseDetail = ExpenseView & {
  /** Ordenadas por `animalId` (ADR-016): el residuo del reparto está en la primera. */
  readonly allocations: readonly ExpenseAllocationView[];
};

/** Respuesta de `POST /expenses` con `dryRun: true`: el reparto que se guardaría. */
export type ExpensePreview = {
  readonly dryRun: true;
  readonly amount: MoneyString;
  readonly method: AllocationMethod;
  readonly allocations: readonly ExpenseAllocationView[];
};

export type ExpenseList = {
  readonly items: readonly ExpenseView[];
  readonly nextCursor: string | null;
};

// ---------------------------------------------------------------------------------------------
// Ventas (ECO-04)
// ---------------------------------------------------------------------------------------------

/**
 * `PATCH /sales/:id`: corregir precio, comprador u observaciones. La fecha es la de la salida;
 * para cambiarla, se revierte la salida y se registra de nuevo.
 */
export const updateSaleSchema = z.object({
  version: versionSchema,
  amount: positiveMoneySchema.optional(),
  buyer: z.string().trim().max(120, { message: 'Máximo 120 caracteres.' }).nullable().optional(),
  notes: z.string().trim().max(2000, { message: 'Máximo 2000 caracteres.' }).nullable().optional(),
});
export type UpdateSaleInput = z.infer<typeof updateSaleSchema>;

export const listSalesQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

export type SaleView = {
  readonly id: string;
  readonly animal: AnimalRef;
  readonly date: IsoDate;
  readonly amount: MoneyString;
  readonly buyer: string | null;
  readonly notes: string | null;
  readonly voided: boolean;
  readonly version: number;
};

export type SaleList = {
  readonly items: readonly SaleView[];
  readonly nextCursor: string | null;
};

// ---------------------------------------------------------------------------------------------
// Avalúos (ECO-03)
// ---------------------------------------------------------------------------------------------

/**
 * `POST /valuations`: a mano con `amount`, o por precio por kilo (último peso hasta la fecha ×
 * precio de la categoría del animal, `settings.pricePerKgByCategory`).
 */
export const createValuationSchema = z
  .object({
    id: clientIdSchema.optional(),
    animalId: uuidSchema,
    date: isoDateSchema,
    method: z.enum(Object.values(VALUATION_METHOD) as [ValuationMethod, ...ValuationMethod[]], {
      message: 'Elige cómo se calcula el avalúo.',
    }),
    amount: positiveMoneySchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.method === VALUATION_METHOD.MANUAL && value.amount === undefined) {
      context.addIssue({ code: 'custom', path: ['amount'], message: 'Escribe el valor.' });
    }
    if (value.method === VALUATION_METHOD.PRICE_PER_KG && value.amount !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'El valor se calcula con el peso y el precio por kilo.',
      });
    }
  });
export type CreateValuationInput = z.infer<typeof createValuationSchema>;

export type ValuationView = {
  readonly id: string;
  readonly animalId: string;
  readonly date: IsoDate;
  readonly amount: MoneyString;
  readonly method: ValuationMethod;
  readonly voided: boolean;
};

// ---------------------------------------------------------------------------------------------
// Ficha: pestaña Costos (ECO-05)
// ---------------------------------------------------------------------------------------------

/** Una asignación del animal, con el gasto del que sale. */
export type AnimalCostLine = {
  readonly expenseId: string;
  readonly date: IsoDate;
  readonly type: ExpenseType;
  readonly description: string;
  readonly method: AllocationMethod;
  /** La parte de este animal. */
  readonly amount: MoneyString;
  /** El gasto completo y entre cuántos animales se repartió. */
  readonly expenseAmount: MoneyString;
  readonly animalCount: number;
  readonly lot: { readonly id: string; readonly name: string } | null;
};

/** `GET /animals/:id/finance`. */
export type AnimalFinance = {
  readonly animalId: string;
  readonly investment: AnimalInvestment;
  /** Asignaciones vigentes, de la más reciente a la más antigua. */
  readonly lines: readonly AnimalCostLine[];
  /** Avalúos vigentes, del más reciente al más antiguo. */
  readonly valuations: readonly ValuationView[];
  readonly sale: SaleView | null;
  readonly result: AnimalResult | null;
};

// ---------------------------------------------------------------------------------------------
// Reporte económico (ECO-06)
// ---------------------------------------------------------------------------------------------

export const financeSummaryQuerySchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    path: ['to'],
    message: 'La fecha final debe ser igual o posterior a la inicial.',
  });
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;

/** `GET /finance/summary`. Sin fechas, del 1.º de enero a hoy. */
export type FinanceSummary = {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Inversión acumulada de los animales activos hoy, por su categoría de manejo actual. */
  readonly herd: {
    readonly animals: number;
    readonly investment: MoneyString;
    readonly byCategory: readonly {
      readonly category: ManagementCategory;
      readonly animals: number;
      readonly investment: MoneyString;
    }[];
  };
  /** Gastos vigentes del período, por tipo y por mes; los generales, aparte. */
  readonly expenses: {
    readonly total: MoneyString;
    readonly allocated: MoneyString;
    readonly general: MoneyString;
    readonly byType: readonly { readonly type: ExpenseType; readonly amount: MoneyString }[];
    /** `month` es `YYYY-MM`; solo los meses con gastos. */
    readonly byMonth: readonly { readonly month: string; readonly amount: MoneyString }[];
  };
  /** Ventas vigentes del período, con la inversión y el resultado de cada animal (RN-18). */
  readonly sales: {
    readonly count: number;
    readonly total: MoneyString;
    readonly investment: MoneyString;
    readonly result: MoneyString;
    readonly items: readonly {
      readonly saleId: string;
      readonly animal: AnimalRef;
      readonly date: IsoDate;
      readonly buyer: string | null;
      readonly amount: MoneyString;
      readonly investment: MoneyString;
      readonly result: MoneyString;
    }[];
  };
};
