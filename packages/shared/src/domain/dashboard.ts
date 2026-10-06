/**
 * Tablero por sistema productivo (RPT-01, CFG-03; 09 §4.1, 06 §5.1).
 *
 * El sistema productivo no cambia datos ni reglas (CFG-03 CA1): cambia qué preguntas propias
 * destaca el tablero, en qué orden, y qué grupo de alertas sale primero. Las preguntas comunes
 * (total, preñadas, partos próximos, vacunas, nacimientos, para venta) salen en todos.
 */

import {
  PRODUCTION_SYSTEM,
  SALES_FOCUS,
  SEX,
  type ProductionSystem,
  type SalesFocus,
  type Sex,
} from '../enums.js';

/**
 * Preguntas propias de un sistema. Las de leche que necesitan el control lechero (en ordeño y
 * secas, leche de ayer y del mes, secar pronto) llegan con M9b: hasta entonces no existen, para
 * no mostrar tarjetas vacías. «¿Cuáles están en retiro de leche?» sí existe: sale de los
 * tratamientos (M6).
 */
export const DASHBOARD_QUESTION = {
  /** ¿Cuántos terneros se destetan este mes y con qué peso? (cría) */
  WEANING: 'WEANING',
  /** ¿Cuál es el intervalo entre partos del hato? (cría, RN-38) */
  CALVING_INTERVAL: 'CALVING_INTERVAL',
  /** ¿Cuántas vacas están horras? (cría) */
  DRY_COWS: 'DRY_COWS',
  /** ¿Cuáles están en retiro de leche? (lechería y doble propósito) */
  MILK_WITHDRAWAL: 'MILK_WITHDRAWAL',
  /** ¿Cuáles alcanzan el peso de venta este mes? (ceba, PES-06 CA3) */
  SALE_WEIGHT: 'SALE_WEIGHT',
  /** ¿Qué lotes ganan menos peso de lo esperado? (ceba, PES-05 CA4) */
  LOW_GAIN_LOTS: 'LOW_GAIN_LOTS',
  /** ¿Cuántos días faltan en promedio para la venta? (ceba, PES-06) */
  DAYS_TO_SALE: 'DAYS_TO_SALE',
} as const;
export type DashboardQuestion = (typeof DASHBOARD_QUESTION)[keyof typeof DASHBOARD_QUESTION];

const CRIA_QUESTIONS = [
  DASHBOARD_QUESTION.WEANING,
  DASHBOARD_QUESTION.CALVING_INTERVAL,
  DASHBOARD_QUESTION.DRY_COWS,
] as const;

const CEBA_QUESTIONS = [
  DASHBOARD_QUESTION.SALE_WEIGHT,
  DASHBOARD_QUESTION.LOW_GAIN_LOTS,
  DASHBOARD_QUESTION.DAYS_TO_SALE,
] as const;

/**
 * Preguntas propias de cada sistema, en el orden en que se muestran (09 §4.1). Doble propósito
 * muestra las de cría hasta que exista el control de leche (M9b): la finca de referencia es de
 * «cría y doble propósito» (08 §1.11). Ciclo completo combina cría y ceba.
 */
const SYSTEM_QUESTIONS: Readonly<Record<ProductionSystem, readonly DashboardQuestion[]>> = {
  [PRODUCTION_SYSTEM.CRIA]: CRIA_QUESTIONS,
  [PRODUCTION_SYSTEM.LEVANTE_CEBA]: CEBA_QUESTIONS,
  [PRODUCTION_SYSTEM.LECHERIA]: [DASHBOARD_QUESTION.MILK_WITHDRAWAL],
  [PRODUCTION_SYSTEM.DOBLE_PROPOSITO]: [...CRIA_QUESTIONS, DASHBOARD_QUESTION.MILK_WITHDRAWAL],
  [PRODUCTION_SYSTEM.CICLO_COMPLETO]: [...CRIA_QUESTIONS, ...CEBA_QUESTIONS],
};

/** Preguntas propias del sistema productivo, en orden. */
export function systemQuestions(system: ProductionSystem): readonly DashboardQuestion[] {
  return SYSTEM_QUESTIONS[system];
}

/** Grupos de la página de Alertas (06 §5.17). */
export type AlertGroupKey = 'vaccines' | 'reproduction' | 'withdrawal' | 'weights';

/**
 * Qué grupo de alertas sale primero en cada sistema (CFG-03 CA1): la ceba mira primero los
 * pesos; la cría y el doble propósito, la reproducción; la lechería, los retiros (leche que no se
 * puede vender). Las vacunas van siempre en el segundo o tercer lugar: son obligatorias en todos.
 */
const ALERT_GROUP_ORDER: Readonly<Record<ProductionSystem, readonly AlertGroupKey[]>> = {
  [PRODUCTION_SYSTEM.CRIA]: ['reproduction', 'vaccines', 'weights', 'withdrawal'],
  [PRODUCTION_SYSTEM.LEVANTE_CEBA]: ['weights', 'vaccines', 'withdrawal', 'reproduction'],
  [PRODUCTION_SYSTEM.LECHERIA]: ['withdrawal', 'reproduction', 'vaccines', 'weights'],
  [PRODUCTION_SYSTEM.DOBLE_PROPOSITO]: ['reproduction', 'withdrawal', 'vaccines', 'weights'],
  [PRODUCTION_SYSTEM.CICLO_COMPLETO]: ['reproduction', 'weights', 'vaccines', 'withdrawal'],
};

/** Orden de los grupos de alertas para el sistema productivo. */
export function alertGroupOrder(system: ProductionSystem): readonly AlertGroupKey[] {
  return ALERT_GROUP_ORDER[system];
}

/** Ordena una lista de grupos (con `key`) según el sistema productivo. */
export function sortAlertGroups<T extends { readonly key: AlertGroupKey }>(
  groups: readonly T[],
  system: ProductionSystem,
): T[] {
  const order = alertGroupOrder(system);
  return [...groups].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/**
 * Sexo en el que se centra «Disponibles para venta» (CFG-03 CA3): machos, hembras o ninguno
 * (los dos, o la finca no lo ha dicho).
 */
export function salesFocusSex(focus: SalesFocus | null): Sex | null {
  if (focus === SALES_FOCUS.MALES) return SEX.MALE;
  if (focus === SALES_FOCUS.FEMALES) return SEX.FEMALE;
  return null;
}
