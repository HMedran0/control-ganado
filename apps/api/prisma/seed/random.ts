/**
 * Generador pseudoaleatorio con semilla fija.
 *
 * El seed tiene que producir exactamente los mismos datos en dos ejecuciones seguidas
 * (03-modelo-datos.md §6), así que no se usa `Math.random` en ninguna parte: todo el azar
 * del hato sale de aquí, y el resultado depende solo de la semilla y del orden de las
 * llamadas.
 *
 * El algoritmo es mulberry32: 32 bits de estado, una línea de aritmética entera y una
 * distribución suficientemente buena para repartir razas, sexos y pesos. No es criptográfico
 * y no debe usarse para nada que lo necesite.
 */

/** Fuente de números pseudoaleatorios reproducible. */
export type SeededRandom = {
  /** Siguiente número en [0, 1). */
  next(): number;
  /** Entero en [min, max], ambos incluidos. */
  int(min: number, max: number): number;
  /** ¿Ocurre un suceso con esta probabilidad? */
  chance(probability: number): boolean;
  /** Un elemento cualquiera de la lista. */
  pick<T>(items: readonly T[]): T;
  /** Un elemento según pesos relativos (mismo largo que `items`). */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Copia barajada de la lista (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Bytes pseudoaleatorios, para la parte aleatoria de los UUIDv7. */
  bytes(length: number): Uint8Array;
};

/** Semilla del seed de la finca de referencia. Cambiarla cambia todos los datos generados. */
export const REFERENCE_FARM_SEED = 0x4c41_4553; // "LAES", por La Esperanza.

/** Semilla del seed de carga. Distinta para que las dos fincas no se parezcan. */
export const LOAD_FARM_SEED = 0x4341_5247; // "CARG", por carga.

/** Crea un generador a partir de una semilla entera. */
export function createRandom(seed: number): SeededRandom {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) throw new Error(`Rango inválido: [${min}, ${max}].`);
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('No se puede elegir de una lista vacía.');
    // `noUncheckedIndexedAccess` obliga a la comprobación; el índice siempre es válido.
    const item = items[int(0, items.length - 1)];
    if (item === undefined) throw new Error('Elemento indefinido en la lista.');
    return item;
  };

  const weighted = <T,>(items: readonly T[], weights: readonly number[]): T => {
    if (items.length !== weights.length) {
      throw new Error('Los pesos deben tener el mismo largo que los elementos.');
    }
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) throw new Error('La suma de los pesos debe ser positiva.');

    let threshold = next() * total;
    for (const [index, weight] of weights.entries()) {
      threshold -= weight;
      if (threshold < 0) {
        const item = items[index];
        if (item === undefined) throw new Error('Elemento indefinido en la lista.');
        return item;
      }
    }
    return pick(items);
  };

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const a = copy[i];
      const b = copy[j];
      if (a === undefined || b === undefined) continue;
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  };

  const bytes = (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = int(0, 255);
    return out;
  };

  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick,
    weighted,
    shuffle,
    bytes,
  };
}

/**
 * Reparte `total` unidades entre `parts` grupos en proporción a los pesos, sin azar y sin
 * perder ni inventar unidades: el residuo va a los grupos con mayor parte fraccionaria
 * (método de los restos mayores). Se usa para las razas y los tramos de nacimientos.
 */
export function distribute(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0) throw new Error('La suma de los pesos debe ser positiva.');

  const exact = weights.map((weight) => (total * weight) / sum);
  const counts = exact.map(Math.floor);
  let remaining = total - counts.reduce((acc, count) => acc + count, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of order) {
    if (remaining <= 0) break;
    counts[index] = (counts[index] ?? 0) + 1;
    remaining -= 1;
  }
  return counts;
}
