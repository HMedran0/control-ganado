import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors.js';
import { sumMoney } from '../money.js';
import { allocateExpense, type AllocationTarget } from './allocation.js';

const animales = (...ids: string[]): AllocationTarget[] => ids.map((animalId) => ({ animalId }));

describe('allocateExpense en partes iguales (RN-17)', () => {
  it('reparte $100.000 entre 3 dando el residuo a la primera', () => {
    const resultado = allocateExpense({
      totalAmount: '100000.00',
      method: 'EQUAL',
      animals: animales('a', 'b', 'c'),
    });
    expect(resultado).toEqual([
      { animalId: 'a', amount: '33334.00' },
      { animalId: 'b', amount: '33333.00' },
      { animalId: 'c', amount: '33333.00' },
    ]);
  });

  it('la suma es exactamente el monto del gasto', () => {
    for (const total of ['100000.00', '1.00', '0.01', '7.00', '999999.99', '1250000.50']) {
      for (const count of [1, 2, 3, 7, 11, 100]) {
        const ids = Array.from({ length: count }, (_value, index) => `a${index}`);
        const resultado = allocateExpense({
          totalAmount: total,
          method: 'EQUAL',
          animals: animales(...ids),
        });
        expect(sumMoney(resultado.map((item) => item.amount)), `${total} / ${count}`).toBe(total);
      }
    }
  });

  it('con un solo animal le asigna todo', () => {
    expect(
      allocateExpense({ totalAmount: '250000.00', method: 'EQUAL', animals: animales('a') }),
    ).toEqual([{ animalId: 'a', amount: '250000.00' }]);
  });

  it('reparte en pesos enteros: los centavos van completos a la primera', () => {
    const resultado = allocateExpense({
      totalAmount: '100.50',
      method: 'EQUAL',
      animals: animales('a', 'b'),
    });
    expect(resultado).toEqual([
      { animalId: 'a', amount: '50.50' },
      { animalId: 'b', amount: '50.00' },
    ]);
  });

  it('un gasto menor que el número de animales se concentra en la primera', () => {
    const resultado = allocateExpense({
      totalAmount: '2.00',
      method: 'EQUAL',
      animals: animales('a', 'b', 'c'),
    });
    expect(resultado).toEqual([
      { animalId: 'a', amount: '2.00' },
      { animalId: 'b', amount: '0.00' },
      { animalId: 'c', amount: '0.00' },
    ]);
  });

  it('reparte exacto cuando divide sin residuo', () => {
    const resultado = allocateExpense({
      totalAmount: '90000.00',
      method: 'EQUAL',
      animals: animales('a', 'b', 'c'),
    });
    expect(resultado.map((item) => item.amount)).toEqual(['30000.00', '30000.00', '30000.00']);
  });

  it('lista vacía: ALLOCATION_EMPTY', () => {
    expect(() =>
      allocateExpense({ totalAmount: '100000.00', method: 'EQUAL', animals: [] }),
    ).toThrowError(DomainError);
    try {
      allocateExpense({ totalAmount: '100000.00', method: 'EQUAL', animals: [] });
    } catch (error) {
      expect((error as DomainError).code).toBe('ALLOCATION_EMPTY');
      expect((error as DomainError).status).toBe(422);
    }
  });

  it('rechaza un monto mal formado', () => {
    expect(() =>
      allocateExpense({ totalAmount: '1,50', method: 'EQUAL', animals: animales('a') }),
    ).toThrowError(DomainError);
  });
});

describe('allocateExpense por peso (RN-17)', () => {
  it('reparte proporcional al peso, con suma exacta', () => {
    const resultado = allocateExpense({
      totalAmount: '100000.00',
      method: 'BY_WEIGHT',
      animals: [
        { animalId: 'a', weightKg: '400.00' },
        { animalId: 'b', weightKg: '300.00' },
        { animalId: 'c', weightKg: '300.00' },
      ],
    });
    expect(resultado).toEqual([
      { animalId: 'a', amount: '40000.00' },
      { animalId: 'b', amount: '30000.00' },
      { animalId: 'c', amount: '30000.00' },
    ]);
    expect(sumMoney(resultado.map((item) => item.amount))).toBe('100000.00');
  });

  it('el residuo del redondeo va a la primera asignación', () => {
    const resultado = allocateExpense({
      totalAmount: '100000.00',
      method: 'BY_WEIGHT',
      animals: [
        { animalId: 'a', weightKg: '100.00' },
        { animalId: 'b', weightKg: '100.00' },
        { animalId: 'c', weightKg: '100.00' },
      ],
    });
    expect(resultado[0]?.amount).toBe('33334.00');
    expect(sumMoney(resultado.map((item) => item.amount))).toBe('100000.00');
  });

  it('respeta los decimales del peso', () => {
    const resultado = allocateExpense({
      totalAmount: '150000.00',
      method: 'BY_WEIGHT',
      animals: [
        { animalId: 'a', weightKg: '425.50' },
        { animalId: 'b', weightKg: '74.50' },
      ],
    });
    expect(sumMoney(resultado.map((item) => item.amount))).toBe('150000.00');
    expect(Number(resultado[0]?.amount)).toBeGreaterThan(Number(resultado[1]?.amount));
  });

  it('un animal sin peso: ALLOCATION_NO_WEIGHT', () => {
    const casos: AllocationTarget[][] = [
      [
        { animalId: 'a', weightKg: '400.00' },
        { animalId: 'b', weightKg: null },
      ],
      [{ animalId: 'a', weightKg: '400.00' }, { animalId: 'b' }],
      [
        { animalId: 'a', weightKg: '400.00' },
        { animalId: 'b', weightKg: '' },
      ],
      [{ animalId: 'a', weightKg: '0.00' }],
    ];
    for (const animals of casos) {
      expect(() =>
        allocateExpense({ totalAmount: '100000.00', method: 'BY_WEIGHT', animals }),
      ).toThrowError(DomainError);
    }
    try {
      allocateExpense({
        totalAmount: '100000.00',
        method: 'BY_WEIGHT',
        animals: [{ animalId: 'a', weightKg: null }],
      });
    } catch (error) {
      expect((error as DomainError).code).toBe('ALLOCATION_NO_WEIGHT');
    }
  });

  it('con un solo animal con peso le asigna todo', () => {
    expect(
      allocateExpense({
        totalAmount: '100000.00',
        method: 'BY_WEIGHT',
        animals: [{ animalId: 'a', weightKg: '425.50' }],
      }),
    ).toEqual([{ animalId: 'a', amount: '100000.00' }]);
  });
});

describe('allocateExpense: orden determinista y montos que no dividen exacto (ADR-016)', () => {
  const uuids = [
    '01920000-0000-7000-8000-00000000000c',
    '01920000-0000-7000-8000-00000000000a',
    '01920000-0000-7000-8000-00000000000b',
  ];

  it('ordena por id: el residuo va al menor, lleguen como lleguen', () => {
    const ordenes = [uuids, [...uuids].reverse(), [uuids[1], uuids[2], uuids[0]]];
    const resultados = ordenes.map((ids) =>
      allocateExpense({
        totalAmount: '100000.00',
        method: 'EQUAL',
        animals: animales(...(ids as string[])),
      }),
    );
    for (const resultado of resultados) {
      expect(resultado).toEqual([
        { animalId: uuids[1], amount: '33334.00' },
        { animalId: uuids[2], amount: '33333.00' },
        { animalId: uuids[0], amount: '33333.00' },
      ]);
    }
  });

  it('el orden es por unidades de código, no alfabético con acentos ni mayúsculas', () => {
    const resultado = allocateExpense({
      totalAmount: '10.00',
      method: 'EQUAL',
      animals: animales('b', 'B', 'a'),
    });
    expect(resultado.map((item) => item.animalId)).toEqual(['B', 'a', 'b']);
  });

  it('$180.001 entre 7, $1.000.000 entre 3 y $99.999 entre 13: ni un centavo perdido', () => {
    const casos: [string, number, string][] = [
      ['180001.00', 7, '25717.00'],
      ['1000000.00', 3, '333334.00'],
      ['99999.00', 13, '7695.00'],
      ['180000.37', 7, '25716.37'],
    ];
    for (const [total, count, first] of casos) {
      const ids = Array.from(
        { length: count },
        (_value, index) => `a${String(index).padStart(2, '0')}`,
      );
      const resultado = allocateExpense({
        totalAmount: total,
        method: 'EQUAL',
        animals: animales(...ids),
      });
      expect(resultado[0]?.amount, `${total} / ${count}`).toBe(first);
      expect(sumMoney(resultado.map((item) => item.amount)), `${total} / ${count}`).toBe(total);
      // Todas menos la primera son la misma cuota en pesos enteros.
      expect(new Set(resultado.slice(1).map((item) => item.amount)).size).toBe(1);
    }
  });

  it('por peso con pesos primos: suma exacta y residuo al menor id', () => {
    const resultado = allocateExpense({
      totalAmount: '180001.00',
      method: 'BY_WEIGHT',
      animals: [
        { animalId: 'c', weightKg: '311.00' },
        { animalId: 'a', weightKg: '293.00' },
        { animalId: 'b', weightKg: '307.00' },
      ],
    });
    // 293/911, 307/911 y 311/911 de $180.001, truncados a pesos; el residuo, a «a».
    expect(resultado).toEqual([
      { animalId: 'a', amount: '57894.00' },
      { animalId: 'b', amount: '60658.00' },
      { animalId: 'c', amount: '61449.00' },
    ]);
    expect(sumMoney(resultado.map((item) => item.amount))).toBe('180001.00');
  });

  it('dice qué animales no tienen peso', () => {
    try {
      allocateExpense({
        totalAmount: '1000.00',
        method: 'BY_WEIGHT',
        animals: [{ animalId: 'c' }, { animalId: 'a', weightKg: '300' }, { animalId: 'b' }],
      });
      expect.unreachable();
    } catch (error) {
      expect((error as DomainError).context).toEqual({ animalIds: 'b,c' });
    }
  });

  it('un animal repetido: VALIDATION_FAILED', () => {
    expect(() =>
      allocateExpense({
        totalAmount: '1000.00',
        method: 'EQUAL',
        animals: animales('a', 'b', 'a'),
      }),
    ).toThrowError(/dos veces/);
  });
});
