import { isoDateFromParts, isoDateParts, lastDayOfMonth, type IsoDate } from '../date.js';
import {
  ICA_AGE_GROUP,
  PRODUCTION_SYSTEM,
  SEX,
  type IcaAgeGroup,
  type ProductionSystem,
  type Sex,
} from '../enums.js';

/**
 * Reportes estándar (RPT-02) y gráficas (RPT-03), M8b.
 */

/** Los reportes de la página Reportes. El económico es el de Finanzas (ECO-06), solo ADMIN. */
export const REPORT = {
  INVENTORY: 'inventory',
  INVENTORY_ICA: 'inventory-ica',
  CYCLE_PROGRESS: 'cycle-progress',
  BIRTHS: 'births',
  VACCINATIONS: 'vaccinations',
  VACCINATION_PENDING: 'vaccination-pending',
  CALVINGS_UPCOMING: 'calvings-upcoming',
  EXITS: 'exits',
  ECONOMIC: 'economic',
} as const;
export type ReportName = (typeof REPORT)[keyof typeof REPORT];

/**
 * Orden de los reportes en cada sistema productivo (CFG-03 CA1, ADR-018) [Validar con la finca
 * piloto, 09 §6]. Cada sistema empieza por lo que más consulta: la cría y el doble propósito, los
 * partos y los nacimientos; la ceba, el inventario, las salidas y la plata; la lechería, los partos
 * (que abren la lactancia) y el inventario. Las vacunas siguen en todos, y el formato ICA va con
 * ellas porque se pide en los ciclos oficiales. El reporte económico es solo del ADMIN: la web lo
 * omite para los demás roles, en el mismo lugar del orden.
 */
const REPORT_ORDER: Readonly<Record<ProductionSystem, readonly ReportName[]>> = {
  [PRODUCTION_SYSTEM.CRIA]: [
    REPORT.CALVINGS_UPCOMING,
    REPORT.BIRTHS,
    REPORT.INVENTORY,
    REPORT.VACCINATION_PENDING,
    REPORT.CYCLE_PROGRESS,
    REPORT.INVENTORY_ICA,
    REPORT.VACCINATIONS,
    REPORT.EXITS,
    REPORT.ECONOMIC,
  ],
  [PRODUCTION_SYSTEM.LEVANTE_CEBA]: [
    REPORT.INVENTORY,
    REPORT.EXITS,
    REPORT.ECONOMIC,
    REPORT.VACCINATION_PENDING,
    REPORT.CYCLE_PROGRESS,
    REPORT.INVENTORY_ICA,
    REPORT.VACCINATIONS,
    REPORT.BIRTHS,
    REPORT.CALVINGS_UPCOMING,
  ],
  [PRODUCTION_SYSTEM.LECHERIA]: [
    REPORT.CALVINGS_UPCOMING,
    REPORT.INVENTORY,
    REPORT.VACCINATION_PENDING,
    REPORT.CYCLE_PROGRESS,
    REPORT.INVENTORY_ICA,
    REPORT.VACCINATIONS,
    REPORT.BIRTHS,
    REPORT.EXITS,
    REPORT.ECONOMIC,
  ],
  [PRODUCTION_SYSTEM.DOBLE_PROPOSITO]: [
    REPORT.CALVINGS_UPCOMING,
    REPORT.BIRTHS,
    REPORT.INVENTORY,
    REPORT.VACCINATION_PENDING,
    REPORT.CYCLE_PROGRESS,
    REPORT.INVENTORY_ICA,
    REPORT.VACCINATIONS,
    REPORT.EXITS,
    REPORT.ECONOMIC,
  ],
  [PRODUCTION_SYSTEM.CICLO_COMPLETO]: [
    REPORT.INVENTORY,
    REPORT.CALVINGS_UPCOMING,
    REPORT.BIRTHS,
    REPORT.EXITS,
    REPORT.VACCINATION_PENDING,
    REPORT.CYCLE_PROGRESS,
    REPORT.INVENTORY_ICA,
    REPORT.VACCINATIONS,
    REPORT.ECONOMIC,
  ],
};

/** Los reportes en el orden del sistema productivo. */
export function reportOrder(system: ProductionSystem): readonly ReportName[] {
  return REPORT_ORDER[system];
}

/**
 * Grupos de edad del ICA por sexo, en el orden del formato (08 §2.2): las hembras tienen dos
 * grupos después de los 3 años; los machos, uno.
 */
export const ICA_GROUPS_BY_SEX: Readonly<Record<Sex, readonly IcaAgeGroup[]>> = {
  [SEX.FEMALE]: [
    ICA_AGE_GROUP.UNDER_3M,
    ICA_AGE_GROUP.M3_TO_9,
    ICA_AGE_GROUP.M9_TO_12,
    ICA_AGE_GROUP.Y1_TO_2,
    ICA_AGE_GROUP.Y2_TO_3,
    ICA_AGE_GROUP.Y3_TO_5,
    ICA_AGE_GROUP.OVER_5Y,
  ],
  [SEX.MALE]: [
    ICA_AGE_GROUP.UNDER_3M,
    ICA_AGE_GROUP.M3_TO_9,
    ICA_AGE_GROUP.M9_TO_12,
    ICA_AGE_GROUP.Y1_TO_2,
    ICA_AGE_GROUP.Y2_TO_3,
    ICA_AGE_GROUP.OVER_3Y,
  ],
};

/** Lo que hace falta para saber si un animal estaba en la finca un día. */
export type HerdPresence = {
  readonly entryDate: IsoDate;
  readonly exitDate: IsoDate | null;
  /** Archivado: un registro por error o duplicado, que no cuenta nunca (RN-11). */
  readonly archived: boolean;
};

/**
 * ¿El animal estaba en la finca al terminar el día `date`? Entró ese día o antes, y no había
 * salido: el día de la salida ya no cuenta (salió ese día). Los archivados no cuentan nunca. Es la
 * regla de la evolución del inventario (RPT-03); su equivalente en SQL lo vigila una prueba.
 */
export function wasInHerdOn(animal: HerdPresence, date: IsoDate): boolean {
  if (animal.archived) return false;
  if (animal.entryDate > date) return false;
  return animal.exitDate === null || animal.exitDate > date;
}

/** Un mes calendario: `2026-09` y sus días primero y último. */
export type ReportMonth = {
  readonly month: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
};

/**
 * Los últimos `count` meses hasta el de `today`, del más viejo al más nuevo. El mes en curso
 * termina hoy, no a fin de mes: el inventario de un día que no ha llegado no existe.
 */
export function lastMonths(today: IsoDate, count: number): ReportMonth[] {
  const { year, month } = isoDateParts(today);
  const months: ReportMonth[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const index = year * 12 + (month - 1) - back;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const end = isoDateFromParts(y, m, lastDayOfMonth(y, m));
    months.push({
      month: `${y}-${String(m).padStart(2, '0')}`,
      from: isoDateFromParts(y, m, 1),
      to: end > today ? today : end,
    });
  }
  return months;
}
