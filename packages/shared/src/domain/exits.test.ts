import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import { exitNeedsWithdrawalConfirmation, isReleasedOnExit } from './exits.js';

const date = toIsoDate('2026-09-20');

describe('exitNeedsWithdrawalConfirmation (RN-22)', () => {
  it('pide confirmar la venta o el sacrificio de un animal en retiro', () => {
    for (const type of ['SALE', 'SLAUGHTER'] as const) {
      expect(
        exitNeedsWithdrawalConfirmation({ type, date, withdrawalUntil: toIsoDate('2026-09-25') }),
      ).toBe(true);
    }
  });

  it('el último día de retiro todavía cuenta', () => {
    expect(exitNeedsWithdrawalConfirmation({ type: 'SALE', date, withdrawalUntil: date })).toBe(
      true,
    );
  });

  it('no pide nada si el retiro ya terminó o no hay retiro', () => {
    expect(
      exitNeedsWithdrawalConfirmation({
        type: 'SALE',
        date,
        withdrawalUntil: toIsoDate('2026-09-19'),
      }),
    ).toBe(false);
    expect(exitNeedsWithdrawalConfirmation({ type: 'SALE', date, withdrawalUntil: null })).toBe(
      false,
    );
  });

  it('no aplica a muerte, robo, traslado ni otra salida', () => {
    for (const type of ['DEATH', 'THEFT', 'TRANSFER', 'OTHER'] as const) {
      expect(exitNeedsWithdrawalConfirmation({ type, date, withdrawalUntil: date })).toBe(false);
    }
  });
});

describe('isReleasedOnExit (IDN-06, RN-32)', () => {
  it('con numeración reutilizable, libera solo las chapetas', () => {
    expect(isReleasedOnExit({ codeReuse: true, type: 'VISUAL_TAG' })).toBe(true);
    for (const type of ['DIN', 'RFID', 'QR', 'BRAND', 'OTHER'] as const) {
      expect(isReleasedOnExit({ codeReuse: true, type })).toBe(false);
    }
  });

  it('sin numeración reutilizable, no libera nada', () => {
    expect(isReleasedOnExit({ codeReuse: false, type: 'VISUAL_TAG' })).toBe(false);
  });
});
