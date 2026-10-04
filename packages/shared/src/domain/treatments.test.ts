import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import { exitNeedsWithdrawalConfirmation } from './exits.js';
import { animalWithdrawals, isWithdrawalActive, treatmentWithdrawal } from './treatments.js';

const d = toIsoDate;

describe('treatmentWithdrawal (SAN-05, 03 §2.5)', () => {
  it('inicio + días de tratamiento + días de retiro, para carne y para leche', () => {
    expect(
      treatmentWithdrawal({
        startedOn: d('2026-09-20'),
        durationDays: 3,
        withdrawalMeatDays: 28,
        withdrawalMilkDays: 7,
      }),
    ).toEqual({ meatUntil: '2026-10-21', milkUntil: '2026-09-30', until: '2026-10-21' });
  });

  it('el retiro de leche puede ser el más lejano', () => {
    expect(
      treatmentWithdrawal({
        startedOn: d('2026-09-20'),
        durationDays: 1,
        withdrawalMeatDays: 2,
        withdrawalMilkDays: 5,
      }).until,
    ).toBe('2026-09-26');
  });

  it('sin días de retiro no deja al animal en retiro', () => {
    expect(
      treatmentWithdrawal({
        startedOn: d('2026-09-20'),
        durationDays: 5,
        withdrawalMeatDays: 0,
        withdrawalMilkDays: 0,
      }),
    ).toEqual({ meatUntil: null, milkUntil: null, until: null });
  });
});

describe('animalWithdrawals', () => {
  it('toma el más lejano de cada tipo entre los tratamientos no anulados', () => {
    const result = animalWithdrawals([
      {
        startedOn: d('2026-09-01'),
        durationDays: 1,
        withdrawalMeatDays: 30,
        withdrawalMilkDays: 2,
        voided: false,
      },
      {
        startedOn: d('2026-09-20'),
        durationDays: 1,
        withdrawalMeatDays: 3,
        withdrawalMilkDays: 10,
        voided: false,
      },
      {
        startedOn: d('2026-09-20'),
        durationDays: 1,
        withdrawalMeatDays: 90,
        withdrawalMilkDays: 90,
        voided: true,
      },
    ]);
    expect(result).toEqual({
      meatUntil: '2026-10-02',
      milkUntil: '2026-10-01',
      until: '2026-10-02',
    });
  });

  it('sin tratamientos, sin retiro', () => {
    expect(animalWithdrawals([])).toEqual({ meatUntil: null, milkUntil: null, until: null });
  });

  it('el último día de retiro cuenta como vigente', () => {
    expect(isWithdrawalActive(d('2026-09-25'), d('2026-09-25'))).toBe(true);
    expect(isWithdrawalActive(d('2026-09-24'), d('2026-09-25'))).toBe(false);
    expect(isWithdrawalActive(null, d('2026-09-25'))).toBe(false);
  });
});

describe('RN-22 usa solo el retiro de carne (M6)', () => {
  it('un retiro de leche vigente no exige confirmar la venta en pie', () => {
    const { meatUntil } = animalWithdrawals([
      {
        startedOn: d('2026-09-20'),
        durationDays: 1,
        withdrawalMeatDays: 0,
        withdrawalMilkDays: 10,
        voided: false,
      },
    ]);
    expect(
      exitNeedsWithdrawalConfirmation({
        type: 'SALE',
        date: d('2026-09-25'),
        meatWithdrawalUntil: meatUntil,
      }),
    ).toBe(false);
  });
});
