/**
 * Receta del hato de la finca de referencia.
 *
 * Todas las cantidades de este archivo son **entradas del diseño**, no resultados: el hato se
 * construye para cumplirlas y `verify.ts` comprueba con las funciones de `@hato/shared` que
 * efectivamente se cumplen. Las que trae 08 §3.2 llevan la referencia; las demás son
 * decisiones del seed y se explican aquí.
 *
 * Cómo cierran las cifras de 08 §3.2 entre sí:
 *
 * - 118 vacas = 64 preñadas + 11 servidas + 29 horras + 14 recién paridas sin volver a servir.
 * - 72 vacas con cría al pie y 74 crías: dos partos de mellizos (inconsistencia resuelta).
 * - 72 con cría = 50 preñadas + 8 servidas + 14 sin servir; las otras 2 preñadas con parto
 *   reciente perdieron la cría al nacer (mortinatos), así que no tienen cría al pie.
 * - 46 vacas sin cría al pie = 29 horras + 12 preñadas + 3 servidas + 2 madres de mortinato.
 *
 * El calendario de partos no es decorativo: manda sobre las tres cosas que el tablero
 * muestra. Una vaca que parió en agosto no puede estar preñada confirmada hoy (no da el
 * tiempo de servicio más palpación), una cría nacida después del 23 de junio no pudo
 * vacunarse en el ciclo oficial que cerró ese día (ADR-004), y una nacida después del 27 de
 * junio todavía no cumple los 90 días de la ventana de brucelosis.
 */

import { toIsoDate, type IsoDate } from '@hato/shared';

/** Ventana de fechas, ambos extremos incluidos. */
export type DateWindow = { readonly from: IsoDate; readonly to: IsoDate };

const window = (from: string, to: string): DateWindow => ({
  from: toIsoDate(from),
  to: toIsoDate(to),
});

/** Composición del hato activo (08 §3.2). */
export const ACTIVE = {
  cows: 118,
  heifers: 34,
  maleCalves: 38,
  femaleCalves: 36,
  youngMales: 52,
  bulls: 4,
  /** Bueyes con etiqueta COTERO; cuentan como machos adultos (08 §3.2). */
  oxen: 2,
} as const;

/** Total de animales activos: 284 (08 §3.2). */
export const ACTIVE_TOTAL =
  ACTIVE.cows +
  ACTIVE.heifers +
  ACTIVE.maleCalves +
  ACTIVE.femaleCalves +
  ACTIVE.youngMales +
  ACTIVE.bulls +
  ACTIVE.oxen;

/** Estado reproductivo de las 118 vacas (08 §3.2). */
export const COW_STATE = {
  /** Preñeces abiertas confirmadas. */
  pregnant: 64,
  /** Preñeces abiertas sin palpar. */
  served: 11,
  /** De las servidas, cuántas llevan más de 90 días sin diagnóstico. */
  servedOver90Days: 3,
  /** Horras: sin preñez abierta y con el último parto hace 7 meses o más (RN-25). */
  dry: 29,
  /** Con cría al pie: último parto hace menos de 7 meses y cría viva. */
  withCalfAtFoot: 72,
} as const;

/** Estado reproductivo de las 34 novillas: «12 servidas, de ellas 7 preñadas» (08 §3.2). */
export const HEIFER_STATE = {
  pregnant: 7,
  served: 5,
} as const;

/**
 * Partos de 2026 con cría muerta al nacer. Se registran como `stillbornCount`, no como
 * animales: un mortinato no tiene ficha ni sexo. Sus madres volvieron a servirse y hoy
 * están preñadas, por eso no aparecen entre las 72 con cría al pie.
 */
export const STILLBIRTHS_2026 = 2;

/** Partos de mellizos entre las crías al pie: resuelven las 72 madres con 74 crías. */
export const TWIN_CALVINGS = 2;

/**
 * Calendario de los partos con cría viva de 2026 que siguen al pie.
 *
 * - `earlyWindow`: madres que ya volvieron a servirse **y** alcanzaron a palpar: preñadas.
 * - `servedWindow`: parieron después del cierre del ciclo oficial; servidas sin diagnóstico.
 * - `recentWindow`: parieron hace poco, todavía sin servir.
 *
 * El hueco entre el 16 de mayo y el 27 de junio es deliberado: deja a todas las crías de
 * `earlyWindow` dentro de la jornada de vacunación del ciclo 2026-1 (16 de mayo) y a las
 * otras dos ventanas después del cierre del ciclo (23 de junio) y de los 90 días de la
 * ventana de brucelosis (27 de junio).
 */
export const CALVING_2026 = {
  early: { window: window('2026-02-26', '2026-05-15'), calvings: 50, calves: 52 },
  served: { window: window('2026-06-28', '2026-07-20'), calvings: 8, calves: 8 },
  recent: { window: window('2026-07-21', '2026-09-15'), calvings: 14, calves: 14 },
  /** Partos con mortinato; sus madres quedan preñadas de nuevo. */
  stillborn: { window: window('2026-03-01', '2026-04-15'), calvings: STILLBIRTHS_2026 },
} as const;

/** Sexo de las crías al pie por ventana; suma 38 machos y 36 hembras (08 §3.2). */
export const CALF_SEX_SPLIT = {
  early: { males: 27, females: 25 },
  served: { males: 4, females: 4 },
  recent: { males: 7, females: 7 },
} as const;

/**
 * Partos anteriores al 26 de febrero de 2026 con cría viva que sigue en el hato o que ya
 * salió. Son los que produjeron el levante, las novillas y los animales vendidos o muertos.
 */
export const EARLIER_CALVINGS = {
  /**
   * Partos de enero y febrero de 2026: sus crías ya pasaron el destete (7 meses), así que
   * son levante y novillas, no terneros. Sus madres no tienen cría al pie.
   */
  january: { window: window('2026-01-05', '2026-02-20'), calvings: 16, males: 8, females: 8 },
  /** El resto del historial 2024–2025. */
  history: { window: window('2024-01-10', '2025-12-08'), calvings: 80 },
} as const;

/** Destino de las 80 crías del historial 2024–2025. */
export const HISTORY_DESTINY = {
  /** Machos de levante activos. Nacidos desde octubre de 2024: hoy tienen menos de 24 meses. */
  youngMales: 44,
  /** Novillas activas. */
  heifers: 26,
  /** Machos vendidos (08 §3.2: 10 ventas, 8 de levante). */
  soldMales: 8,
  /** Macho muerto en 2026. */
  deadMale: 1,
  /** Hembra muerta en 2025. */
  deadFemale: 1,
} as const;

/**
 * Un macho nacido antes de esta fecha tendría hoy 24 meses o más y sería macho adulto, no
 * levante. Los partos anteriores solo pueden producir hembras o machos que ya salieron.
 */
export const YOUNG_MALE_EARLIEST_BIRTH = toIsoDate('2024-10-05');

/** Reparto de los partos desde 2024 entre las 118 vacas. */
export const COW_CALVING_PATTERNS = {
  /** Con parto reciente (2026) y dos partos anteriores. */
  recentPlusTwo: 10,
  /** Con parto reciente y uno anterior. */
  recentPlusOne: 42,
  /** Solo el parto reciente. */
  recentOnly: 22,
  /** Sin parto reciente, con uno anterior. */
  earlierOnly: 34,
  /** Sin partos desde 2024: su último parto es histórico (anterior a 2024). */
  none: 10,
} as const;

/** Días mínimos entre dos partos de la misma vaca. */
export const MIN_CALVING_INTERVAL_DAYS = 330;

/** Salidas del hato (08 §3.2). */
export const EXITS = {
  sales: 10,
  deaths: 3,
} as const;

/** Levante marcado «Disponible para venta» (08 §3.2). */
export const FOR_SALE_YOUNG_MALES = 14;

/** Partos previstos dentro de la ventana de alerta de 30 días. Decisión del seed. */
export const CALVINGS_DUE_SOON = 9;

/**
 * Animales que se perdieron la jornada del ciclo oficial 2026-1 y quedan con aftosa y rabia
 * vencidas. Decisión del seed: sin ellos el tablero no tendría ninguna alerta vencida que
 * mostrar, y en una finca extensiva siempre queda ganado en el potrero lejano.
 */
export const MISSED_OFFICIAL_CYCLE = 6;

/** Hembras de 90 a 270 días sin brucelosis (08 §3.2; terneras o novillas jóvenes). */
export const BRUCELLOSIS_PENDING = 14;

/** Jornadas de vacunación. Todas son fechas del seed, dentro de los ciclos configurados. */
export const VACCINATION_DAYS = {
  /** Ciclo oficial 2025-2 (27/10/2025–16/12/2025): aftosa y rabia. */
  cycle2025: toIsoDate('2025-11-08'),
  /** Ciclo oficial 2026-1 (04/05/2026–23/06/2026): aftosa y rabia. */
  cycle2026: toIsoDate('2026-05-16'),
  /** Clostridial, jornada anual. */
  clostridial2025: toIsoDate('2025-03-11'),
  clostridial2026: toIsoDate('2026-03-10'),
  /**
   * Visita aparte del veterinario a los reproductores: toros y bueyes reciben la clostridial
   * en octubre y no en la jornada de marzo, así que su refuerzo (02/10/2026) cae dentro de
   * la ventana de alerta de 15 días y aparecen como «próxima».
   */
  clostridialBulls: toIsoDate('2025-10-02'),
} as const;

/** Edad a la que se aplica la brucelosis, en días (dentro de la ventana de 90 a 270). */
export const BRUCELLOSIS_AGE_DAYS = { min: 95, max: 160 } as const;

/** Días de vida a partir de los cuales un animal recibe el hierro de la finca. */
export const BRAND_AGE_DAYS = 730;

/** Fechas de pesaje con cinta del levante, cada tres meses (08 §3.2). */
export const WEIGHING_DAYS: readonly IsoDate[] = [
  toIsoDate('2025-03-15'),
  toIsoDate('2025-06-15'),
  toIsoDate('2025-09-15'),
  toIsoDate('2025-12-15'),
  toIsoDate('2026-03-15'),
  toIsoDate('2026-06-15'),
  toIsoDate('2026-09-15'),
];

/** Proporción de servicios por monta natural; el resto es inseminación (08 §3.2). */
export const NATURAL_SERVICE_SHARE = 0.85;

/** Segunda fecha de evaluación de las alertas, con el ciclo oficial 2026-2 abierto. */
export const SECOND_EVALUATION_DATE = toIsoDate('2026-11-15');
