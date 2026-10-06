/**
 * Página de Alertas (M6; 06 §4): reproducción, vacunación, retiros y pesos en una sola lista, con
 * conteos por tipo y filtros por tipo y lote. Las consultas usan la misma CTE de clasificación del
 * listado (ADR-009); lo que se muestra de cada fila sale de shared.
 */

import { z } from 'zod';

import type { IsoDate } from '../date.js';
import type { AlertGroupKey } from '../domain/dashboard.js';
import { ANIMAL_ALERT, type AnimalAlert } from '../enums.js';
import type { AnimalListItem, VaccineStatusView } from './animals.js';
import type { WeightSummary } from './weights.js';

const uuidSchema = z.uuid({ message: 'El identificador no es válido.' });

/** Valores separados por coma (`?types=vaccine_overdue,low_gain`). */
function csv<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .string()
    .transform((value) => [
      ...new Set(
        value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== ''),
      ),
    ])
    .pipe(z.array(item))
    .optional();
}

/** `GET /alerts`. Varios `types` se combinan con «o»; varios `lotId`, también. */
export const alertsQuerySchema = z.object({
  types: csv(
    z.enum(Object.values(ANIMAL_ALERT) as [AnimalAlert, ...AnimalAlert[]], {
      message: 'Alerta no válida.',
    }),
  ),
  lotId: csv(uuidSchema),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type AlertsQuery = z.infer<typeof alertsQuerySchema>;

/** Una fila de la página de Alertas: la fila del listado con el detalle de sus alertas. */
export type AlertItem = AnimalListItem & {
  /** Vacunas vencidas, pendientes o próximas. */
  readonly vaccines: readonly VaccineStatusView[];
  /** Retiros vigentes (carne y leche). */
  readonly withdrawals: { readonly meatUntil: IsoDate | null; readonly milkUntil: IsoDate | null };
  /** Preñez abierta, para las alertas reproductivas. */
  readonly pregnancy: {
    readonly serviceDate: IsoDate;
    readonly confirmedAt: IsoDate | null;
    readonly expectedCalvingDate: IsoDate;
  } | null;
  readonly weight: WeightSummary | null;
};

/** Respuesta de `GET /alerts`. */
export type AlertsResponse = {
  /** Animales activos con cada alerta, con el filtro de lote aplicado (no el de tipo). */
  readonly counts: Readonly<Record<AnimalAlert, number>>;
  readonly items: readonly AlertItem[];
  readonly nextCursor: string | null;
  /** Animales con alguna de las alertas pedidas. */
  readonly total: number;
};

/** Grupos de la página, en el orden en que se muestran. */
export const ALERT_GROUPS: readonly {
  readonly key: AlertGroupKey;
  readonly label: string;
  readonly types: readonly AnimalAlert[];
}[] = [
  {
    key: 'vaccines',
    label: 'Vacunas',
    types: [ANIMAL_ALERT.VACCINE_OVERDUE, ANIMAL_ALERT.VACCINE_DUE],
  },
  {
    key: 'reproduction',
    label: 'Reproducción',
    types: [
      ANIMAL_ALERT.CALVING_OVERDUE,
      ANIMAL_ALERT.CALVING_SOON,
      ANIMAL_ALERT.UNCONFIRMED_SERVICE,
    ],
  },
  { key: 'withdrawal', label: 'Retiros', types: [ANIMAL_ALERT.WITHDRAWAL] },
  { key: 'weights', label: 'Pesos', types: [ANIMAL_ALERT.LOW_GAIN, ANIMAL_ALERT.WEIGHT_LOSS] },
];
