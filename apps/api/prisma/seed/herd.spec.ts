import { compareIsoDates, daysBetween, type IsoDate } from '@hato/shared';
import { describe, expect, it } from 'vitest';

import { SEED_TODAY } from './guards.js';
import { MIN_CALVING_INTERVAL_DAYS } from './plan.js';
import { buildReferenceSeed } from './run.js';

/**
 * El generador del hato, sin base de datos.
 *
 * `verifyHerd` ya compara las cifras contra `expected.ts` dentro del propio seed; lo que se
 * comprueba aquí es que esa verificación se ejecuta y pasa, que el resultado es
 * reproducible, y las invariantes que no son cifras del tablero.
 */

const seed = buildReferenceSeed(SEED_TODAY);

describe('buildReferenceSeed', () => {
  it('genera un hato que cumple las cifras esperadas y las reglas de negocio', () => {
    expect(seed.problems).toEqual([]);
  });

  it('produce exactamente los mismos datos en dos construcciones', () => {
    const again = buildReferenceSeed(SEED_TODAY);

    expect(again.herd.animals).toEqual(seed.herd.animals);
    expect(again.herd.pregnancies).toEqual(seed.herd.pregnancies);
    expect(again.history.vaccinations).toEqual(seed.history.vaccinations);
    expect(again.economics.expenses).toEqual(seed.economics.expenses);
    expect(again.catalog.farmId).toBe(seed.catalog.farmId);
  });

  it('respeta el intervalo mínimo entre partos de una misma vaca', () => {
    const byDam = new Map<string, IsoDate[]>();
    for (const pregnancy of seed.herd.pregnancies) {
      if (pregnancy.outcomeDate === null) continue;
      byDam.set(pregnancy.damId, [...(byDam.get(pregnancy.damId) ?? []), pregnancy.outcomeDate]);
    }

    const tooClose: string[] = [];
    for (const [damId, dates] of byDam) {
      const sorted = [...dates].sort(compareIsoDates);
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (previous === undefined || current === undefined) continue;
        if (daysBetween(previous, current) < MIN_CALVING_INTERVAL_DAYS) {
          tooClose.push(`${damId}: ${previous} → ${current}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('mantiene la paridez de cada vaca entre 1 y 7 partos (08 §3.2)', () => {
    const counts = new Map<string, number>();
    for (const pregnancy of seed.herd.pregnancies) {
      if (pregnancy.outcome !== 'CALVED') continue;
      counts.set(pregnancy.damId, (counts.get(pregnancy.damId) ?? 0) + 1);
    }
    const parities = [...counts.values()];
    expect(Math.min(...parities)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...parities)).toBeLessThanOrEqual(7);
  });

  it('usa monta natural en cerca del 85 % de los servicios (08 §3.2)', () => {
    const withSire = seed.herd.pregnancies.filter((pregnancy) => !pregnancy.isImported);
    const natural = withSire.filter((pregnancy) => pregnancy.method === 'NATURAL').length;
    expect(natural / withSire.length).toBeGreaterThan(0.8);
    expect(natural / withSire.length).toBeLessThan(0.9);
  });

  it('da a las crías la raza de su madre, para que la gestación concuerde', () => {
    const wrong = seed.herd.animals.filter((animal) => {
      const dam = animal.damId === null ? undefined : seed.herd.byId.get(animal.damId);
      return dam !== undefined && dam.breedName !== animal.breedName;
    });
    expect(wrong).toEqual([]);
  });
});
