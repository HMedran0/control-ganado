import { describe, expect, it } from 'vitest';

import { ANIMAL_STATUS, EXIT_TYPE } from '../enums.js';
import { animalStatus } from './animal-status.js';

describe('animalStatus (CLS-03)', () => {
  it('sin salida ni archivo, activo', () => {
    expect(animalStatus({ archived: false, exitType: null })).toBe(ANIMAL_STATUS.ACTIVE);
  });

  it('salida por venta: vendido', () => {
    expect(animalStatus({ archived: false, exitType: EXIT_TYPE.SALE })).toBe(ANIMAL_STATUS.SOLD);
  });

  it('cualquier otra salida: retirado', () => {
    for (const exitType of [
      EXIT_TYPE.DEATH,
      EXIT_TYPE.SLAUGHTER,
      EXIT_TYPE.THEFT,
      EXIT_TYPE.TRANSFER,
      EXIT_TYPE.OTHER,
    ]) {
      expect(animalStatus({ archived: false, exitType })).toBe(ANIMAL_STATUS.RETIRED);
    }
  });

  it('archivado manda sobre la salida', () => {
    expect(animalStatus({ archived: true, exitType: null })).toBe(ANIMAL_STATUS.ARCHIVED);
    expect(animalStatus({ archived: true, exitType: EXIT_TYPE.SALE })).toBe(ANIMAL_STATUS.ARCHIVED);
  });
});
