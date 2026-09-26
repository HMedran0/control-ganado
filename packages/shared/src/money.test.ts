import { describe, expect, it } from 'vitest';

import { DomainError } from './errors.js';
import { CENTS_PER_PESO, formatMoneyValue, parseMoney, pesosToCents, sumMoney } from './money.js';

describe('parseMoney', () => {
  it('convierte a centavos', () => {
    expect(parseMoney('1250000.00')).toBe(125_000_000n);
    expect(parseMoney('100000')).toBe(10_000_000n);
    expect(parseMoney('0.01')).toBe(1n);
    expect(parseMoney('0.1')).toBe(10n);
    expect(parseMoney('0')).toBe(0n);
  });

  it('acepta montos negativos y espacios alrededor', () => {
    expect(parseMoney('-500.25')).toBe(-50_025n);
    expect(parseMoney('  750.50  ')).toBe(75_050n);
  });

  it('mantiene la precisión donde el punto flotante la pierde', () => {
    expect(formatMoneyValue(parseMoney('0.10') + parseMoney('0.20'))).toBe('0.30');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('rechaza lo que no es un decimal con máximo dos decimales', () => {
    expect(() => parseMoney('1.234')).toThrowError(DomainError);
    expect(() => parseMoney('1,50')).toThrowError(DomainError);
    expect(() => parseMoney('abc')).toThrowError(DomainError);
    expect(() => parseMoney('')).toThrowError(DomainError);
    expect(() => parseMoney('1e5')).toThrowError(DomainError);
  });

  it('el error explica el problema en español', () => {
    try {
      parseMoney('1,50');
    } catch (error) {
      expect((error as DomainError).code).toBe('VALIDATION_FAILED');
      expect((error as DomainError).detail).toContain('dos decimales');
    }
  });
});

describe('formatMoneyValue', () => {
  it('siempre escribe dos decimales', () => {
    expect(formatMoneyValue(125_000_000n)).toBe('1250000.00');
    expect(formatMoneyValue(1n)).toBe('0.01');
    expect(formatMoneyValue(0n)).toBe('0.00');
    expect(formatMoneyValue(-50_025n)).toBe('-500.25');
  });

  it('es la inversa de parseMoney', () => {
    for (const value of ['0.00', '0.05', '99.99', '1250000.00', '-42.10']) {
      expect(formatMoneyValue(parseMoney(value))).toBe(value);
    }
  });
});

describe('pesosToCents y sumMoney', () => {
  it('convierte pesos enteros', () => {
    expect(pesosToCents(33_334n)).toBe(3_333_400n);
    expect(CENTS_PER_PESO).toBe(100n);
  });

  it('suma una lista de montos', () => {
    expect(sumMoney(['33334.00', '33333.00', '33333.00'])).toBe('100000.00');
    expect(sumMoney([])).toBe('0.00');
  });
});
