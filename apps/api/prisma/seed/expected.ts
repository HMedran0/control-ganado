/**
 * Cifras que el tablero debe mostrar con la finca de referencia sembrada (RPT-01).
 *
 * Son el **contrato** del seed. Se comprueban dos veces y por caminos independientes:
 *
 * - `verify.ts` las recalcula sobre los datos generados con las funciones de
 *   `@hato/shared` (`managementCategory`, `derivedTags`, `vaccineStatus`) antes de escribir
 *   nada; si algo no coincide, el seed aborta;
 * - `test/seed.e2e-spec.ts` las vuelve a calcular con consultas SQL contra la base de datos
 *   ya sembrada, sin pasar por el código del seed.
 *
 * La mayoría sale de `08-dominio-y-finca-referencia.md` §3.2. Las que no están en el
 * documento son decisiones del seed y llevan su explicación.
 *
 * Todo está anclado a `SEED_TODAY = 2026-09-25`: mover esa fecha invalida el archivo entero.
 */

import { toIsoDate, type IsoDate } from '@hato/shared';

/** Estados que devuelve `vaccineStatus`, con el nombre que usa el tablero. */
export type VaccineTally = {
  /** Tiene la aplicación que le correspondía. */
  readonly upToDate: number;
  /** Le corresponde ahora y no la tiene. */
  readonly pending: number;
  /** Pasó la oportunidad de aplicarla. */
  readonly overdue: number;
  /** Vence dentro de la ventana de alerta de la finca (15 días). */
  readonly upcoming: number;
  /** No es elegible, o no estaba en la finca cuando cerró el ciclo (ADR-004). */
  readonly notApplicable: number;
};

/** Inventario y clasificación (08 §3.2). */
export const EXPECTED_INVENTORY = {
  /** Animales en la base, incluidos los que ya salieron. */
  total: 297,
  /** `deleted_at IS NULL AND exit_type IS NULL`. */
  active: 284,
  males: 96,
  females: 188,
  /** Categorías de manejo, exclusivas y derivadas (RN-06). */
  category: {
    CALF_MALE: 38,
    CALF_FEMALE: 36,
    HEIFER: 34,
    COW: 118,
    YOUNG_MALE: 52,
    /**
     * Seis y no cuatro: los cuatro toros más los dos bueyes coteros, que 08 §3.2 dice
     * expresamente que «cuentan como machos adultos».
     */
    ADULT_MALE: 6,
  },
} as const;

/** Reproducción (08 §3.2). */
export const EXPECTED_REPRODUCTION = {
  /** Preñez abierta confirmada: 64 vacas + 7 novillas (RN-08). */
  pregnant: 71,
  /** Preñez abierta sin palpar: 11 vacas + 5 novillas. */
  served: 16,
  /** De las servidas, las que llevan más de 90 días sin diagnóstico. */
  servedOver90Days: 3,
  /** Horras (RN-25). */
  dry: 29,
  /** Vacas con cría viva de menos de siete meses. */
  withCalfAtFoot: 72,
  /** Preñeces confirmadas con parto previsto dentro de los 30 días de alerta. */
  calvingsDueSoon: 9,
  /** Con al menos un parto (RN-07). */
  calved: 118,
  /** Con período de retiro vigente. */
  withdrawal: 2,
} as const;

/**
 * Nacimientos de 2026 (NAC-01).
 *
 * Se cuentan **todos** los nacidos en el período, aunque después hubieran muerto o se
 * hubieran vendido: el filtro es la fecha de nacimiento, no el estado actual. En esta finca
 * ninguno de los 10 vendidos ni de los 3 muertos nació en 2026, así que la cifra coincide
 * con la de los activos; la consulta de la prueba igual se hace sin filtrar por salida.
 *
 * Las crías muertas al nacer **no** son animales: no tienen ficha ni sexo, se registran en
 * `pregnancies.stillborn_count` y por eso van aparte.
 */
export const EXPECTED_BIRTHS_2026 = {
  live: 90,
  liveMales: 46,
  liveFemales: 44,
  stillborn: 2,
} as const;

/** Salidas y disponibilidad (08 §3.2). */
export const EXPECTED_EXITS = {
  sold: 10,
  dead: 3,
  forSale: 14,
} as const;

/**
 * Estado de las vacunas hoy, 25 de septiembre de 2026.
 *
 * Hoy **no hay ciclo oficial abierto**: el 2026-1 cerró el 23 de junio y el 2026-2 abre el
 * 1.º de noviembre. Por eso aftosa y rabia no pueden estar «pendientes», solo al día o
 * vencidas (el vacunador de Fedegán ya no puede expedir un RUV de un ciclo cerrado). La
 * segunda tabla, con el ciclo 2026-2 abierto, cubre ese caso.
 */
export const EXPECTED_VACCINES_TODAY: Readonly<Record<string, VaccineTally>> = {
  /**
   * 22 no aplica: las crías nacidas después del 23 de junio no pudieron vacunarse en el
   * ciclo que cerró ese día (RN-13, ADR-004). 6 vencidas: los que se perdieron la jornada
   * del 16 de mayo.
   */
  Aftosa: { upToDate: 256, pending: 0, overdue: 6, upcoming: 0, notApplicable: 22 },
  'Rabia silvestre': { upToDate: 256, pending: 0, overdue: 6, upcoming: 0, notApplicable: 22 },
  /**
   * 14 pendientes: las hembras de 90 a 270 días sin aplicación (08 §3.2). No hay vencidas
   * porque toda hembra que pasó la ventana tiene su aplicación registrada. 107 no aplica:
   * 96 machos (la vacuna es solo de hembras y se bloquea en machos, RN-26) y 11 terneras
   * que todavía no cumplen los 90 días.
   */
  'Brucelosis RB51': { upToDate: 163, pending: 14, overdue: 0, upcoming: 0, notApplicable: 107 },
  /**
   * 68 pendientes: los animales que en la jornada anual del 10 de marzo de 2026 tenían
   * menos de 90 días —nacidos desde diciembre de 2025— y que hoy ya cumplieron los 90, así
   * que les corresponde y no la tienen. 6 próximas: los toros y los bueyes, vacunados en la
   * visita del 2 de octubre de 2025, cuyo refuerzo cae dentro de la ventana de 15 días.
   * 22 no aplica: los que todavía no llegan a los 90 días.
   */
  'Clostridial polivalente': {
    upToDate: 188,
    pending: 68,
    overdue: 0,
    upcoming: 6,
    notApplicable: 22,
  },
};

/**
 * Los mismos datos evaluados el 15 de noviembre de 2026, con el ciclo oficial 2026-2
 * abierto (1.º de noviembre – 15 de diciembre).
 *
 * No hace falta otro seed: cambia solo la fecha de evaluación. Sirve para cubrir el estado
 * «pendiente» de las vacunas de ciclo oficial, que hoy es imposible, y el paso de la
 * clostridial de los toros a vencida.
 */
export const SECOND_EVALUATION: IsoDate = toIsoDate('2026-11-15');

export const EXPECTED_VACCINES_AT_SECOND_DATE: Readonly<Record<string, VaccineTally>> = {
  /** Ciclo abierto y ninguna aplicación dentro de él: todo el hato queda pendiente. */
  Aftosa: { upToDate: 0, pending: 284, overdue: 0, upcoming: 0, notApplicable: 0 },
  'Rabia silvestre': { upToDate: 0, pending: 284, overdue: 0, upcoming: 0, notApplicable: 0 },
  /**
   * Tres de las catorce pendientes pasaron de 270 días y quedan «fuera de edad»; entran
   * las terneras que mientras tanto cumplieron los 90 días.
   */
  'Brucelosis RB51': { upToDate: 163, pending: 19, overdue: 3, upcoming: 0, notApplicable: 99 },
  /** El refuerzo de los toros venció el 2 de octubre. */
  'Clostridial polivalente': {
    upToDate: 188,
    pending: 83,
    overdue: 6,
    upcoming: 0,
    notApplicable: 7,
  },
};

/** Catálogos sembrados (03-modelo-datos.md §2.2 y 08 §3.3). */
export const EXPECTED_CATALOG = {
  users: 4,
  breeds: 15,
  vaccines: 4,
  cycles: 3,
  lots: 4,
  tags: 1,
} as const;

/** Reparto por lote de los animales activos (08 §1.10). */
export const EXPECTED_LOTS = {
  /** Vacas con cría al pie y sus crías. */
  Paridas: 146,
  /** Vacas sin cría al pie y novillas. */
  'Horras y novillas': 80,
  Levante: 52,
  /** Cuatro toros y dos bueyes coteros. */
  Toros: 6,
} as const;

/**
 * Finca El Retiro (08 §3.5, M4c): numeración reutilizable. Decisiones del seed, porque 08 solo
 * pide «numeración 1–40» y «al menos dos números reutilizados»: 38 activos (del 1 al 40 sin el
 * 17 ni el 33), tres salidas (el 5 y el 17 vendidos, el 12 muerto), y los números 5 y 12
 * repetidos entre un activo y uno que salió.
 */
export const EXPECTED_RETIRO = {
  total: 41,
  active: 38,
  exited: 3,
  /** Números normalizados que comparten un activo y uno que salió (RN-33). */
  reusedCodes: ['12', '5'],
  /** Menor número libre entre los activos (ANI-10 CA2). */
  nextCode: '17',
  /** Chapetas liberadas al salir (`EXITED`): las de los tres que salieron. */
  releasedTags: 3,
  /** DIN y RFID que siguen activos en el 5 vendido (RN-32). */
  lifelongOnSold: ['DIN', 'RFID'],
  users: 1,
} as const;
