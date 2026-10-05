import type { AuditEntryView } from '@hato/shared';
import { describe, expect, it } from 'vitest';

import { changeText, entryChanges, entryMeta, entryTitle, valueText } from './audit';

const entry = (patch: Partial<AuditEntryView>): AuditEntryView => ({
  id: '1',
  at: '2026-09-25T12:00:00.000Z',
  action: 'UPDATE',
  entity: 'Animal',
  entityId: 'a',
  entityLabel: '5',
  entityDate: null,
  animalCode: '5',
  user: { id: 'u', name: 'Álvaro Pérez' },
  changes: [],
  ...patch,
});

describe('Cambios en lenguaje de finca (AUD-01 CA2)', () => {
  it('una frase con quién, qué hizo y sobre qué', () => {
    expect(entryTitle(entry({ action: 'EXIT' }))).toBe(
      'Álvaro Pérez registró la salida del animal 5',
    );
    expect(entryTitle(entry({ action: 'UPDATE', entity: 'Identifier', entityLabel: '5' }))).toBe(
      'Álvaro Pérez cambió el identificador 5',
    );
    expect(entryTitle(entry({ action: 'REVERT_EXIT' }))).toBe(
      'Álvaro Pérez revirtió la salida del animal 5',
    );
    expect(entryTitle(entry({ user: null, action: 'CREATE' }))).toBe(
      'El sistema registró el animal 5',
    );
  });

  it('eventos de M5 y M6: la vacuna, el tratamiento, el pesaje, la preñez, la báscula', () => {
    const voided = entry({
      action: 'VOID',
      entity: 'VaccinationRecord',
      entityLabel: 'Aftosa',
      entityDate: '2026-05-12' as AuditEntryView['entityDate'],
      user: { id: 'w', name: 'Wilmer' },
      changes: [{ field: 'reason', before: null, after: 'Era otra vaca' }],
    });
    expect(entryTitle(voided)).toBe(
      'Wilmer anuló la vacuna Aftosa del 12/05/2026 · motivo: Era otra vaca',
    );
    // El motivo ya va en la frase: no se repite debajo.
    expect(entryChanges(voided)).toEqual([]);

    const day = '2026-09-20' as AuditEntryView['entityDate'];
    expect(
      entryTitle(
        entry({
          action: 'CREATE',
          entity: 'TreatmentRecord',
          entityLabel: 'Oxitetraciclina',
          entityDate: day,
        }),
      ),
    ).toBe('Álvaro Pérez registró el tratamiento con Oxitetraciclina del 20/09/2026');
    expect(
      entryTitle(
        entry({ action: 'CREATE', entity: 'WeightRecord', entityLabel: '320.5', entityDate: day }),
      ),
    ).toBe('Álvaro Pérez registró el pesaje de 320,5 kg del 20/09/2026');
    expect(
      entryTitle(
        entry({
          entity: 'Pregnancy',
          entityLabel: null,
          entityDate: '2025-11-02' as AuditEntryView['entityDate'],
          changes: [{ field: 'outcome', before: 'PENDING', after: 'CALVED' }],
        }),
      ),
    ).toBe('Álvaro Pérez registró el parto de la preñez con servicio del 02/11/2025');
    expect(
      entryTitle(entry({ action: 'CREATE', entity: 'ScaleProfile', entityLabel: 'Corral' })),
    ).toBe('Álvaro Pérez registró el perfil de báscula Corral');
    expect(
      entryTitle(entry({ action: 'IMPORT', entity: 'ImportBatch', entityLabel: 'pesaje.csv' })),
    ).toBe('Álvaro Pérez importó el archivo pesaje.csv');
  });

  it('el mismo campo con su sentido en cada entidad', () => {
    expect(changeText({ field: 'method', before: null, after: 'AI' }, 'Pregnancy')).toBe(
      'Tipo de servicio: Inseminación',
    );
    expect(changeText({ field: 'method', before: null, after: 'TAPE' }, 'WeightRecord')).toBe(
      'Método: Cinta',
    );
    expect(changeText({ field: 'outcome', before: 'PENDING', after: 'ABORTED' }, 'Pregnancy')).toBe(
      'Desenlace: Abierta → Aborto',
    );
    expect(changeText({ field: 'weightKg', before: null, after: 320.5 }, 'WeightRecord')).toBe(
      'Peso (kg): 320,5',
    );
  });

  it('finanzas (M7): el ADMIN ve los montos en pesos y la corrección como frase', () => {
    const sale = entry({
      action: 'UPDATE',
      entity: 'Sale',
      entityLabel: null,
      animalCode: '087',
      user: { id: 'h', name: 'Héctor' },
      changes: [{ field: 'amount', before: '3200000.00', after: '2800000.00' }],
    });
    expect(entryTitle(sale)).toBe('Héctor corrigió la venta de 087');
    expect(changeText(sale.changes[0] as AuditEntryView['changes'][number], 'Sale')).toBe(
      'Precio: $ 3.200.000 → $ 2.800.000',
    );
    expect(
      entryTitle(
        entry({
          action: 'UPDATE',
          entity: 'Expense',
          entityLabel: 'Sal mineralizada',
          entityDate: '2026-05-12' as AuditEntryView['entityDate'],
          user: { id: 'h', name: 'Héctor' },
        }),
      ),
    ).toBe('Héctor corrigió el gasto Sal mineralizada del 12/05/2026');
    expect(changeText({ field: 'share', before: '4737.00', after: '4865.00' }, 'Expense')).toBe(
      'Su parte: $ 4.737 → $ 4.865',
    );
    expect(changeText({ field: 'type', before: null, after: 'FEED' }, 'Expense')).toBe(
      'Tipo de gasto: Alimentación',
    );
    expect(changeText({ field: 'purchasePrice', before: null, after: '2800000.00' })).toBe(
      'Valor de compra: $ 2.800.000',
    );
  });

  it('fecha y hora en la zona de la finca', () => {
    expect(entryMeta(entry({}), 'America/Bogota')).toMatch(/^25\/09\/2026, 7:00/);
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

  it('etiquetas: qué se agregó y qué se quitó, con su nombre (ADR-012)', () => {
    expect(changeText({ field: 'tagIds', before: ['Cotero'], after: ['Descarte'] })).toBe(
      'Agregó la etiqueta Descarte · Quitó la etiqueta Cotero',
    );
    expect(changeText({ field: 'tagIds', before: ['Cotero', 'Descarte'], after: ['Cotero'] })).toBe(
      'Quitó la etiqueta Descarte',
    );
    expect(changeText({ field: 'tagIds', before: null, after: ['Cotero'] })).toBe(
      'Agregó la etiqueta Cotero',
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
