import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors.js';
import { animalInvestment, animalResult, valuationByPricePerKg } from './finance.js';

describe('animalInvestment (RN-18, ECO-05)', () => {
  it('suma las asignaciones vigentes, en total y por tipo en el orden del catálogo', () => {
    const investment = animalInvestment([
      { type: 'FEED', amount: '4737.00', voided: false },
      { type: 'PURCHASE', amount: '2800000.00', voided: false },
      { type: 'FEED', amount: '4736.00', voided: false },
      { type: 'MEDICATION', amount: '85000.00', voided: false },
    ]);
    expect(investment).toEqual({
      total: '2894473.00',
      byType: [
        { type: 'PURCHASE', amount: '2800000.00' },
        { type: 'FEED', amount: '9473.00' },
        { type: 'MEDICATION', amount: '85000.00' },
      ],
    });
  });

  it('lo anulado no cuenta; sin nada, cero y sin tipos', () => {
    expect(
      animalInvestment([
        { type: 'VACCINE', amount: '3500.00', voided: true },
        { type: 'FEED', amount: '0.50', voided: false },
      ]),
    ).toEqual({ total: '0.50', byType: [{ type: 'FEED', amount: '0.50' }] });
    expect(animalInvestment([])).toEqual({ total: '0.00', byType: [] });
  });
});

describe('animalResult (ECO-05 CA1)', () => {
  it('venta − inversión; la venta manda sobre el avalúo', () => {
    expect(
      animalResult({ investment: '2894473.00', saleAmount: '3200000.00', valuationAmount: '1.00' }),
    ).toEqual({ basis: 'SALE', amount: '305527.00' });
  });

  it('pérdida en negativo; sin venta, el estimado con el avalúo; sin nada, null', () => {
    expect(
      animalResult({ investment: '3000000.00', saleAmount: '2800000.00', valuationAmount: null }),
    ).toEqual({ basis: 'SALE', amount: '-200000.00' });
    expect(
      animalResult({ investment: '100.00', saleAmount: null, valuationAmount: '3510000.00' }),
    ).toEqual({ basis: 'VALUATION', amount: '3509900.00' });
    expect(
      animalResult({ investment: '0.00', saleAmount: null, valuationAmount: null }),
    ).toBeNull();
  });
});

describe('valuationByPricePerKg (ECO-03 CA1)', () => {
  it('peso × precio por kilo, en pesos enteros', () => {
    expect(valuationByPricePerKg('450', '7800.00')).toBe('3510000.00');
    expect(valuationByPricePerKg('320.5', '7800.00')).toBe('2499900.00');
  });

  it('redondea a peso con mitad hacia arriba', () => {
    // 1,01 kg × $0,50 = $0,505 → $1; 0,99 kg × $0,50 = $0,495 → $0.
    expect(valuationByPricePerKg('1.01', '0.50')).toBe('1.00');
    expect(valuationByPricePerKg('0.99', '0.50')).toBe('0.00');
    expect(valuationByPricePerKg('100.01', '7799.99')).toBe('780077.00');
  });

  it('rechaza un peso mal formado', () => {
    expect(() => valuationByPricePerKg('-3', '7800.00')).toThrowError(DomainError);
    expect(() => valuationByPricePerKg('3,5', '7800.00')).toThrowError(DomainError);
  });
});
