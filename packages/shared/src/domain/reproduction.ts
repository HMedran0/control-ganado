/**
 * Reglas del control reproductivo (REP-01 a REP-05, RN-02 a RN-08, RN-14, RN-15, RN-23, RN-38).
 *
 * Lo que necesita la base (una preñez abierta por hembra, códigos libres) lo resuelve la API; aquí
 * queda lo que se calcula igual en la API, la web y, en la fase 2, la app sin conexión.
 */

import { addDays, addMonths, daysBetween, type IsoDate } from '../date.js';
import { PREGNANCY_OUTCOME, type PregnancyOutcome } from '../enums.js';
import { ageInMonths } from './age.js';

/** Crías por parto: de 1 a 3 (REP-04 CA3). */
export const MIN_CALVES_PER_CALVING = 1;
export const MAX_CALVES_PER_CALVING = 3;

/** Meses de gestación que se pueden indicar al confirmar una preñez sin servicio (REP-02 CA3). */
export const MAX_ESTIMATED_GESTATION_MONTHS = 9;

/**
 * Días de gestación cumplidos a una fecha: desde el servicio (real o estimado) hasta `today`.
 * Nunca negativo.
 */
export function gestationDaysElapsed(serviceDate: IsoDate, today: IsoDate): number {
  return Math.max(0, daysBetween(serviceDate, today));
}

/**
 * Fecha de servicio estimada de una preñez confirmada sin servicio conocido (REP-02 CA3): la del
 * diagnóstico menos los meses de gestación que indicó quien palpó.
 */
export function serviceDateFromGestationMonths(diagnosisDate: IsoDate, months: number): IsoDate {
  return addMonths(diagnosisDate, -months);
}

/**
 * Fecha de servicio estimada de un parto sin preñez registrada (REP-04 CA1, RN-29): el parto menos
 * la gestación aplicable (RN-04). La preñez queda con `serviceDateEstimated`, así que no entra en
 * los indicadores reproductivos (RN-38).
 */
export function estimatedServiceDate(calvingDate: IsoDate, gestationDays: number): IsoDate {
  return addDays(calvingDate, -gestationDays);
}

/** Entrada de `isBreedingAgeLow`. */
export type BreedingAgeInput = {
  readonly birthDate: IsoDate;
  readonly serviceDate: IsoDate;
  /** `Farm.settings.minBreedingAgeMonths` (RN-15). */
  readonly minBreedingAgeMonths: number;
};

/**
 * ¿La hembra tenía menos de la edad mínima reproductiva en la fecha? Es advertencia, no bloqueo:
 * RN-15 en el servicio y RN-23 en el parto (la madre de una cría).
 */
export function isBreedingAgeLow(input: BreedingAgeInput): boolean {
  return ageInMonths(input.birthDate, input.serviceDate) < input.minBreedingAgeMonths;
}

/** Entrada de `isCalvingOverdue`. */
export type CalvingOverdueInput = {
  /** Parto estimado de la preñez abierta (confirmada o no). */
  readonly expectedCalvingDate: IsoDate;
  /** `Farm.settings.overdueCalvingAlertDays`, 15 por defecto [Validar]. */
  readonly overdueCalvingAlertDays: number;
  readonly today: IsoDate;
};

/**
 * «Parto vencido sin registrar»: la preñez sigue abierta y su fecha de parto estimada pasó hace
 * **más** de `overdueCalvingAlertDays`. Pide registrar el parto o el aborto.
 */
export function isCalvingOverdue(input: CalvingOverdueInput): boolean {
  return daysBetween(input.expectedCalvingDate, input.today) > input.overdueCalvingAlertDays;
}

/** Preñez, reducida a lo que necesita el intervalo entre partos. */
export type CalvingIntervalPregnancy = {
  readonly outcome: PregnancyOutcome;
  /** Fecha del parto; `null` si no la hay. */
  readonly outcomeDate: IsoDate | null;
  /** La fecha de servicio no es real: palpación sin servicio, parto sin preñez o importación. */
  readonly serviceDateEstimated: boolean;
  readonly voided: boolean;
};

/** Un intervalo entre dos partos consecutivos. */
export type CalvingInterval = {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly days: number;
};

/** Intervalos entre partos de una hembra (REP-05 CA1; tablero de M8). */
export type CalvingIntervals = {
  /** Del más antiguo al más reciente. */
  readonly intervals: readonly CalvingInterval[];
  /** Días del intervalo más reciente; `null` si no hay ninguno válido. */
  readonly lastDays: number | null;
  /** Promedio redondeado de los intervalos válidos; `null` si no hay ninguno. */
  readonly averageDays: number | null;
};

/**
 * Intervalos entre partos con la regla RN-38: solo cuentan las preñeces con fecha de servicio
 * real.
 *
 * Los partos (preñeces `CALVED` no anuladas y con fecha) se ordenan por fecha y se toma cada par
 * de partos **consecutivos**. Un par entra solo si ninguno de los dos tiene servicio estimado.
 * No se salta un parto estimado para unir los de sus lados: eso inventaría un intervalo que en
 * realidad abarca dos ciclos. Los partos anteriores importados sin fecha
 * (`imported_prior_calvings`, RN-29) no son preñeces y no participan.
 */
export function calvingIntervals(
  pregnancies: readonly CalvingIntervalPregnancy[],
): CalvingIntervals {
  const calvings = pregnancies
    .filter(
      (pregnancy): pregnancy is CalvingIntervalPregnancy & { outcomeDate: IsoDate } =>
        !pregnancy.voided &&
        pregnancy.outcome === PREGNANCY_OUTCOME.CALVED &&
        pregnancy.outcomeDate !== null,
    )
    .sort((left, right) =>
      left.outcomeDate < right.outcomeDate ? -1 : left.outcomeDate > right.outcomeDate ? 1 : 0,
    );

  const intervals: CalvingInterval[] = [];
  for (let index = 1; index < calvings.length; index += 1) {
    const previous = calvings[index - 1];
    const current = calvings[index];
    if (previous === undefined || current === undefined) continue;
    if (previous.serviceDateEstimated || current.serviceDateEstimated) continue;
    intervals.push({
      from: previous.outcomeDate,
      to: current.outcomeDate,
      days: daysBetween(previous.outcomeDate, current.outcomeDate),
    });
  }

  const last = intervals.at(-1);
  return {
    intervals,
    lastDays: last === undefined ? null : last.days,
    averageDays:
      intervals.length === 0
        ? null
        : Math.round(
            intervals.reduce((sum, interval) => sum + interval.days, 0) / intervals.length,
          ),
  };
}

/**
 * Rangos de la distribución del intervalo entre partos del hato (M8a), en días, con el límite
 * inferior incluido y el superior excluido. Son rangos para leer la distribución, no umbrales:
 * la referencia de UPRA (2024) para doble propósito, 387 a 439 días, se muestra solo como texto.
 */
export const CALVING_INTERVAL_BUCKETS = [
  { key: 'UNDER_365', fromDays: 0, toDays: 365 },
  { key: 'D365_399', fromDays: 365, toDays: 400 },
  { key: 'D400_439', fromDays: 400, toDays: 440 },
  { key: 'D440_499', fromDays: 440, toDays: 500 },
  { key: 'D500_PLUS', fromDays: 500, toDays: null },
] as const;
export type CalvingIntervalBucket = (typeof CALVING_INTERVAL_BUCKETS)[number]['key'];

/** Intervalo entre partos del hato (RN-38). */
export type HerdCalvingIntervals = {
  /** Intervalos válidos que entran en el cálculo. */
  readonly count: number;
  /** Hembras con al menos un intervalo válido. */
  readonly females: number;
  /** Promedio redondeado de todos los intervalos; `null` sin ninguno. */
  readonly averageDays: number | null;
  /** Cuántos intervalos caen en cada rango, en el orden de `CALVING_INTERVAL_BUCKETS`. */
  readonly distribution: readonly {
    readonly bucket: CalvingIntervalBucket;
    readonly count: number;
  }[];
};

/** Rango de un intervalo. */
export function calvingIntervalBucket(days: number): CalvingIntervalBucket {
  const bucket = CALVING_INTERVAL_BUCKETS.find(
    (candidate) =>
      days >= candidate.fromDays && (candidate.toDays === null || days < candidate.toDays),
  );
  return bucket?.key ?? 'UNDER_365';
}

/**
 * Intervalo entre partos del hato (M8a, RN-38): todos los intervalos válidos de cada hembra según
 * `calvingIntervals` (que ya excluye los pares con servicio estimado), juntos. El promedio es el
 * de los intervalos, no el de los promedios de cada hembra: una vaca con cinco partos pesa más
 * que una con dos, como en un registro de partos. Quién entra (las hembras activas) lo decide
 * quien llama.
 */
export function herdCalvingIntervals(
  perFemale: readonly (readonly CalvingIntervalPregnancy[])[],
): HerdCalvingIntervals {
  const days = perFemale.flatMap((pregnancies) =>
    calvingIntervals(pregnancies).intervals.map((interval) => interval.days),
  );
  const females = perFemale.filter(
    (pregnancies) => calvingIntervals(pregnancies).intervals.length > 0,
  ).length;
  const counts = new Map<CalvingIntervalBucket, number>();
  for (const value of days) {
    const bucket = calvingIntervalBucket(value);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return {
    count: days.length,
    females,
    averageDays:
      days.length === 0
        ? null
        : Math.round(days.reduce((sum, value) => sum + value, 0) / days.length),
    distribution: CALVING_INTERVAL_BUCKETS.map(({ key }) => ({
      bucket: key,
      count: counts.get(key) ?? 0,
    })),
  };
}
