import type { AuditEntryView } from '@hato/shared';
import { describe, expect, it } from 'vitest';

import { changeText, entryMeta, entryTitle, valueText } from './audit';

const entry = (patch: Partial<AuditEntryView>): AuditEntryView => ({
  id: '1',
  at: '2026-09-25T12:00:00.000Z',
  action: 'UPDATE',
  entity: 'Animal',
  entityId: 'a',
  entityLabel: '5',
  user: { id: 'u', name: 'Álvaro Pérez' },
  changes: [],
  ...patch,
});

describe('Cambios en lenguaje de finca (AUD-01 CA2)', () => {
  it('título con la acción y el registro', () => {
    expect(entryTitle(entry({ action: 'EXIT' }))).toBe('Salida · animal 5');
    expect(entryTitle(entry({ action: 'UPDATE', entity: 'Identifier', entityLabel: '5' }))).toBe(
      'Cambio · identificador 5',
    );
    expect(entryTitle(entry({ action: 'REVERT_EXIT' }))).toBe('Salida revertida · animal 5');
  });

  it('fecha y hora en la zona de la finca, con quién lo hizo', () => {
    expect(entryMeta(entry({}), 'America/Bogota')).toMatch(/^25\/09\/2026, 7:00.* · Álvaro Pérez$/);
    expect(entryMeta(entry({ user: null }), 'America/Bogota')).toMatch(/· Sistema$/);
  });

  it('cambio con antes y después, y registro solo con el valor nuevo', () => {
    expect(changeText({ field: 'lotId', before: null, after: 'Levante' })).toBe('Lote: Levante');
    expect(changeText({ field: 'lotId', before: 'Paridas', after: 'Levante' })).toBe(
      'Lote: Paridas → Levante',
    );
    expect(changeText({ field: 'password', before: null, after: null })).toBe(
      'Cambió la contraseña',
    );
  });

  it('valores traducidos: sí/no, fechas, enumeraciones e identificadores', () => {
    expect(valueText('forSale', true)).toBe('Sí');
    expect(valueText('exitDate', '2026-09-20')).toBe('20/09/2026');
    expect(valueText('exitType', 'SALE')).toBe('Venta');
    expect(valueText('sex', 'FEMALE')).toBe('Hembra');
    expect(valueText('retireReason', 'EXITED')).toBe('Liberada al salir de la finca');
    expect(valueText('releasedIdentifiers', ['VISUAL_TAG:5'])).toBe('Chapeta 5');
    expect(valueText('notes', null)).toBe('—');
    expect(valueText('tagIds', [])).toBe('—');
  });
});
