/**
 * Tablero de Inicio (RPT-01, CFG-03, PES-05, PES-06, RN-38; M8a). `GET /dashboard` responde los
 * indicadores comunes y solo las secciones propias del sistema productivo de la finca
 * (`questions`). Cada cifra sale de SQL con la misma CTE de clasificación del listado y de
 * Alertas (ADR-009), así que coincide con el total del listado filtrado al que enlaza.
 */

import type { IsoDate } from '../date.js';
import type { DashboardQuestion } from '../domain/dashboard.js';
import type { HerdCalvingIntervals } from '../domain/reproduction.js';
import type { AnimalAlert, ProductionSystem, SalesFocus, Sex } from '../enums.js';
import type { MoneyString } from '../money.js';

/** Lote con su ganancia de 90 días frente al umbral de sus animales (PES-05 CA4). */
export type DashboardLotGain = {
  readonly lotId: string;
  readonly name: string;
  /** Animales del lote con umbral de ganancia y ganancia de 90 días. */
  readonly animals: number;
  /** Promedio de la ganancia de 90 días de esos animales, en kg/día (milésimas). */
  readonly averageGain: number;
  /** Promedio del umbral de su categoría, en kg/día (milésimas). */
  readonly averageThreshold: number;
  /** Animales del lote con la alerta «Ganancia baja». */
  readonly lowGain: number;
};

export type DashboardResponse = {
  readonly today: IsoDate;
  readonly productionSystem: ProductionSystem;
  readonly salesFocus: SalesFocus | null;
  /** Preguntas propias del sistema, en orden (`systemQuestions`). */
  readonly questions: readonly DashboardQuestion[];

  /** ¿Cuántos animales hay? Activos, con machos, hembras y crías. */
  readonly herd: {
    readonly total: number;
    readonly males: number;
    readonly females: number;
    readonly calvesMale: number;
    readonly calvesFemale: number;
  };
  /** ¿Cuántas están preñadas? Y servidas sin palpar. */
  readonly reproduction: {
    readonly pregnant: number;
    readonly served: number;
    readonly calvingSoon: number;
    readonly calvingOverdue: number;
    /** La preñez con el parto estimado más próximo dentro de la ventana de alerta. */
    readonly nextCalving: {
      readonly animalId: string;
      readonly code: string;
      readonly expectedCalvingDate: IsoDate;
    } | null;
  };
  /** ¿Cuántos nacieron este año? Mismo criterio que el reporte de nacimientos (NAC-01). */
  readonly births: {
    readonly from: IsoDate;
    readonly to: IsoDate;
    readonly live: number;
    readonly males: number;
    readonly females: number;
  };
  /** ¿Qué falta vacunar? Animales con alguna vacuna vencida o pendiente o próxima. */
  readonly vaccines: {
    /** Con alguna vacuna vencida o pendiente o próxima: cada animal una vez (Alertas con las dos). */
    readonly pending: number;
    readonly overdue: number;
    readonly due: number;
    /** Ciclo oficial en curso hoy, para mostrar su avance (SAN-02 CA2); `null` si no hay. */
    readonly currentCycle: { readonly id: string; readonly name: string } | null;
  };
  /** Animales activos con cada alerta, como en Alertas. */
  readonly alerts: Readonly<Record<AnimalAlert, number>>;
  /** ¿Cuáles están para venta? Centrado en `salesFocus` (CFG-03 CA3). */
  readonly forSale: { readonly count: number; readonly sex: Sex | null };

  /** Destete del mes (cría): nacidos en `bornFrom`–`bornTo`, activos. */
  readonly weaning?: {
    readonly bornFrom: IsoDate;
    readonly bornTo: IsoDate;
    readonly count: number;
    /** Cuántos tienen pesaje y su último peso promedio (kg, una cifra decimal). */
    readonly weighed: number;
    readonly averageWeightKg: number | null;
  };
  /** Intervalo entre partos de las hembras activas (RN-38). */
  readonly calvingInterval?: HerdCalvingIntervals;
  /** Vacas horras. */
  readonly dryCows?: { readonly count: number };
  /** Animales activos con retiro de leche vigente. */
  readonly milkWithdrawal?: { readonly count: number };
  /** Peso de venta (PES-06): medido, estimado este mes y posiblemente en el peso. */
  readonly saleWeight?: {
    readonly monthEnd: IsoDate;
    readonly reached: number;
    readonly thisMonth: number;
    readonly likelyReached: number;
    readonly later: number;
  };
  /** Lotes y su ganancia de 90 días (PES-05 CA4); `belowThreshold` primero. */
  readonly lotGains?: {
    readonly belowThreshold: readonly DashboardLotGain[];
    readonly others: readonly DashboardLotGain[];
  };
  /** Días promedio que faltan para el peso de venta, de los que tienen fecha estimada futura. */
  readonly daysToSale?: { readonly averageDays: number | null; readonly animals: number };

  /** Inversión total del hato activo (RN-18). Solo ADMIN (RN-20): para los demás no existe. */
  readonly investment?: MoneyString;
};
