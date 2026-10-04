/**
 * Pesos: ganancia diaria, alertas y pesos atípicos (PES-01, PES-02, PES-05; ADR-015).
 *
 * La ficha, el listado, la página de Alertas y la importación de la báscula usan estas funciones
 * (RN-27). El SQL de `weight-gain.sql.ts` (API) es su traducción para filtrar y contar, y la
 * prueba de equivalencia de ADR-009 compara los dos caminos animal por animal.
 *
 * **Aritmética exacta.** La ganancia se calcula con enteros: los kilos en centésimas (la columna
 * es `numeric(7,2)`) y las fechas en días. La pendiente de la regresión es un cociente de enteros
 * y se redondea a milésimas de kg/día **mitad lejos de cero** con división entera (`BigInt`), la
 * misma cuenta que hace el SQL con `numeric`. Así un animal justo en el umbral da el mismo
 * resultado en los dos lados: no hay coma flotante antes de comparar.
 */

import { addDays, daysBetween, type IsoDate } from '../date.js';
import type { ManagementCategory } from '../enums.js';

/** Ventana de la ganancia «de los últimos 90 días» (PES-05 CA1). */
export const WEIGHT_GAIN_WINDOW_DAYS = 90;
/** Los pesajes de la regresión deben abarcar al menos estos días (ADR-015). */
export const WEIGHT_GAIN_MIN_SPAN_DAYS = 30;
/** Un peso se aleja «mucho» del anterior si difiere más de este porcentaje (PES-01 CA2). */
export const WEIGHT_OUTLIER_PERCENT = 30;
/** Por defecto, el ancla de la ventana puede estar hasta 180 días antes de su inicio [Validar]. */
export const DEFAULT_WEIGHT_GAIN_ANCHOR_MAX_DAYS = 180;

/** Pesaje, reducido a lo que necesitan la ganancia y las alertas. */
export type WeightRecordLike = {
  /** Desempata dos pesajes del mismo día: el UUIDv7 ordena por creación. */
  readonly id: string;
  readonly weighedOn: IsoDate;
  /** Kilos con hasta dos decimales. */
  readonly weightKg: number;
  readonly isBirthWeight: boolean;
  /** `voided_at IS NOT NULL`. Los anulados no cuentan (RN-11). */
  readonly voided: boolean;
};

/** Kilos a centésimas de kilo, el entero exacto de `numeric(7,2)`. */
export function weightCents(weightKg: number): number {
  return Math.round(weightKg * 100);
}

/** Milésimas de kg/día a kg/día, para mostrar. */
export function gainFromMilli(milli: number): number {
  return milli / 1000;
}

/** kg/día del umbral a milésimas (los umbrales admiten hasta tres decimales). */
export function gainToMilli(kgPerDay: number): number {
  return Math.round(kgPerDay * 1000);
}

/** Pesajes válidos en orden: fecha y, el mismo día, orden de creación. */
export function sortedValidWeights(records: readonly WeightRecordLike[]): WeightRecordLike[] {
  return records
    .filter((record) => !record.voided)
    .sort((a, b) =>
      a.weighedOn === b.weighedOn
        ? a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0
        : a.weighedOn < b.weighedOn
          ? -1
          : 1,
    );
}

/**
 * Pendiente de la regresión lineal por mínimos cuadrados, en milésimas de kg/día, redondeada mitad
 * lejos de cero. `null` si todos los puntos son del mismo día.
 *
 * Con `x` en días e `y` en centésimas de kilo: pendiente = N / D, con N = nΣxy − ΣxΣy y
 * D = nΣx² − (Σx)², en centésimas por día; en milésimas de kg/día es 10·N / D. Con dos puntos da
 * exactamente (y₂ − y₁) / (x₂ − x₁).
 */
export function regressionGainMilli(
  points: readonly { readonly day: IsoDate; readonly weightKg: number }[],
): number | null {
  const first = points[0];
  if (first === undefined) return null;
  let n = 0n;
  let sumX = 0n;
  let sumY = 0n;
  let sumXY = 0n;
  let sumXX = 0n;
  for (const point of points) {
    const x = BigInt(daysBetween(first.day, point.day));
    const y = BigInt(weightCents(point.weightKg));
    n += 1n;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0n) return null;
  const magnitude = numerator < 0n ? -numerator : numerator;
  // floor(10·|N| / D + 1/2) = floor((20·|N| + D) / (2·D)), en enteros.
  const rounded = (20n * magnitude + denominator) / (2n * denominator);
  return Number(numerator < 0n ? -rounded : rounded);
}

/** Ganancias diarias de un animal (PES-02 CA1, PES-05 CA1), en milésimas de kg/día. */
export type WeightGains = {
  /** Entre el último pesaje y el anterior de una fecha anterior. */
  readonly lastTwoMilli: number | null;
  /** Regresión de la ventana de 90 días con su ancla (ADR-015). */
  readonly last90DaysMilli: number | null;
  /** Desde el peso al nacer hasta el último pesaje. */
  readonly sinceBirthMilli: number | null;
};

/** Entrada de `weightGains`. */
export type WeightGainsInput = {
  /** Pesajes del animal, anulados incluidos. */
  readonly records: readonly WeightRecordLike[];
  /** `Farm.settings.weightGainAnchorMaxDays`, 180 por defecto [Validar]. */
  readonly anchorMaxDays: number;
  readonly today: IsoDate;
};

/** Último pesaje y el último de una fecha anterior: los «dos últimos» de PES-02 y PES-05 CA3. */
export function lastTwoWeights(
  records: readonly WeightRecordLike[],
): { readonly last: WeightRecordLike; readonly previous: WeightRecordLike | null } | null {
  const valid = sortedValidWeights(records);
  const last = valid.at(-1);
  if (last === undefined) return null;
  const previous = valid.filter((record) => record.weighedOn < last.weighedOn).at(-1) ?? null;
  return { last, previous };
}

/**
 * Pesajes de la ganancia de 90 días (ADR-015): los de la ventana `[hoy − 90, hoy]` más el último
 * anterior a la ventana como **ancla**, si está a lo sumo `anchorMaxDays` antes de su inicio. Hace
 * falta al menos un pesaje dentro de la ventana, dos puntos y 30 días entre el primero y el último;
 * si no, `null`.
 *
 * Con pesaje trimestral (15/06 y 15/09, hoy 25/09): la ventana empieza el 27/06 y solo trae el del
 * 15/09; el del 15/06 entra como ancla (12 días antes del inicio) y la ganancia es la de esos dos.
 */
export function last90DaysPoints(input: WeightGainsInput): readonly WeightRecordLike[] | null {
  const valid = sortedValidWeights(input.records);
  const windowStart = addDays(input.today, -WEIGHT_GAIN_WINDOW_DAYS);
  const inWindow = valid.filter(
    (record) => record.weighedOn >= windowStart && record.weighedOn <= input.today,
  );
  if (inWindow.length === 0) return null;

  const anchor = valid.filter((record) => record.weighedOn < windowStart).at(-1);
  const points =
    anchor !== undefined && daysBetween(anchor.weighedOn, windowStart) <= input.anchorMaxDays
      ? [anchor, ...inWindow]
      : inWindow;

  const first = points[0];
  const last = points.at(-1);
  if (points.length < 2 || first === undefined || last === undefined) return null;
  if (daysBetween(first.weighedOn, last.weighedOn) < WEIGHT_GAIN_MIN_SPAN_DAYS) return null;
  return points;
}

function gainBetween(from: WeightRecordLike, to: WeightRecordLike): number | null {
  return regressionGainMilli([
    { day: from.weighedOn, weightKg: from.weightKg },
    { day: to.weighedOn, weightKg: to.weightKg },
  ]);
}

/** Ganancias diarias del animal (PES-02 CA1, PES-05 CA1; ADR-015). */
export function weightGains(input: WeightGainsInput): WeightGains {
  const pair = lastTwoWeights(input.records);
  const lastTwoMilli = pair?.previous == null ? null : gainBetween(pair.previous, pair.last);

  const points = last90DaysPoints(input);
  const last90DaysMilli =
    points === null
      ? null
      : regressionGainMilli(
          points.map((record) => ({ day: record.weighedOn, weightKg: record.weightKg })),
        );

  const birth = sortedValidWeights(input.records).find((record) => record.isBirthWeight);
  const sinceBirthMilli =
    birth === undefined || pair === null || pair.last.weighedOn <= birth.weighedOn
      ? null
      : gainBetween(birth, pair.last);

  return { lastTwoMilli, last90DaysMilli, sinceBirthMilli };
}

/** Parámetros de la finca para las alertas de peso (PES-05; 03 §2.1). */
export type WeightAlertSettings = {
  /** Umbral de «Ganancia baja» por categoría de manejo, en kg/día. Sin umbral, no hay alerta. */
  readonly weightGainAlertKgPerDay: Partial<Readonly<Record<ManagementCategory, number>>>;
  /** «Perdió peso» si el último pesaje baja más de este porcentaje respecto al anterior. */
  readonly weightLossAlertPercent: number;
  /** Antigüedad máxima del ancla de la ventana de 90 días (ADR-015). */
  readonly weightGainAnchorMaxDays: number;
};

/** Entrada de `weightAlerts`. */
export type WeightAlertsInput = {
  readonly records: readonly WeightRecordLike[];
  readonly category: ManagementCategory;
  readonly settings: WeightAlertSettings;
  readonly today: IsoDate;
};

/** Resultado de `weightAlerts`. */
export type WeightAlertsResult = {
  readonly gains: WeightGains;
  /** PES-05 CA2: ganancia de 90 días menor que el umbral de su categoría. */
  readonly lowGain: boolean;
  /** PES-05 CA3: el último pesaje bajó más del porcentaje configurado respecto al anterior. */
  readonly weightLoss: boolean;
  /** Porcentaje que bajó el último pesaje respecto al anterior (positivo si bajó). */
  readonly lossPercent: number | null;
};

/**
 * ¿El último pesaje es menor que el anterior en **más** de `percent`? Con enteros:
 * 100 · (anterior − último) > percent · anterior.
 */
export function isWeightLoss(previousKg: number, lastKg: number, percent: number): boolean {
  const previous = weightCents(previousKg);
  const last = weightCents(lastKg);
  return 100 * (previous - last) > percent * previous;
}

/** Alertas de peso de un animal (PES-05 CA2 y CA3). */
export function weightAlerts(input: WeightAlertsInput): WeightAlertsResult {
  const gains = weightGains({
    records: input.records,
    anchorMaxDays: input.settings.weightGainAnchorMaxDays,
    today: input.today,
  });

  const threshold = input.settings.weightGainAlertKgPerDay[input.category];
  const lowGain =
    threshold !== undefined &&
    gains.last90DaysMilli !== null &&
    gains.last90DaysMilli < gainToMilli(threshold);

  const pair = lastTwoWeights(input.records);
  const previous = pair?.previous ?? null;
  const weightLoss =
    pair !== null &&
    previous !== null &&
    isWeightLoss(previous.weightKg, pair.last.weightKg, input.settings.weightLossAlertPercent);
  const lossPercent =
    pair === null || previous === null || previous.weightKg === 0
      ? null
      : Math.round(((previous.weightKg - pair.last.weightKg) / previous.weightKg) * 1000) / 10;

  return { gains, lowGain, weightLoss, lossPercent };
}

/**
 * ¿El peso se aleja más del 30 % del anterior? (PES-01 CA2). Solo advierte, no bloquea. Con
 * enteros: 100 · |nuevo − anterior| > 30 · anterior.
 */
export function isWeightOutlier(previousKg: number, newKg: number): boolean {
  const previous = weightCents(previousKg);
  const current = weightCents(newKg);
  return 100 * Math.abs(current - previous) > WEIGHT_OUTLIER_PERCENT * previous;
}

/**
 * Pesaje con el que se compara uno nuevo del día `on` (PES-01 CA2): el último válido de ese día o
 * de antes. `null` si es el primero.
 */
export function previousWeightFor(
  records: readonly WeightRecordLike[],
  on: IsoDate,
): WeightRecordLike | null {
  return (
    sortedValidWeights(records)
      .filter((record) => record.weighedOn <= on)
      .at(-1) ?? null
  );
}
