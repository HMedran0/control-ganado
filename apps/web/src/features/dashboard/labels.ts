import {
  PRODUCTION_SYSTEM,
  SALES_FOCUS,
  type CalvingIntervalBucket,
  type ProductionSystem,
  type SalesFocus,
} from '@hato/shared';

/** Sistema productivo (CFG-03), como lo dice el ganadero. */
export const PRODUCTION_SYSTEM_LABEL: Readonly<Record<ProductionSystem, string>> = {
  [PRODUCTION_SYSTEM.CRIA]: 'Cría',
  [PRODUCTION_SYSTEM.LEVANTE_CEBA]: 'Levante y ceba',
  [PRODUCTION_SYSTEM.LECHERIA]: 'Lechería especializada',
  [PRODUCTION_SYSTEM.DOBLE_PROPOSITO]: 'Doble propósito',
  [PRODUCTION_SYSTEM.CICLO_COMPLETO]: 'Ciclo completo',
};

/** Qué vende principalmente la finca (CFG-03 CA3). */
export const SALES_FOCUS_LABEL: Readonly<Record<SalesFocus, string>> = {
  [SALES_FOCUS.MALES]: 'Machos',
  [SALES_FOCUS.FEMALES]: 'Hembras',
  [SALES_FOCUS.BOTH]: 'Los dos',
};

/** Rangos de la distribución del intervalo entre partos (RN-38). */
export const CALVING_INTERVAL_BUCKET_LABEL: Readonly<Record<CalvingIntervalBucket, string>> = {
  UNDER_365: 'Menos de 365 días',
  D365_399: '365 a 399 días',
  D400_439: '400 a 439 días',
  D440_499: '440 a 499 días',
  D500_PLUS: '500 días o más',
};
