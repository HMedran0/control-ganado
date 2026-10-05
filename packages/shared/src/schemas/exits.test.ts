import { describe, expect, it } from 'vitest';

import { uuidv7 } from '../id.js';
import {
  animalCodeSchema,
  archiveAnimalSchema,
  exitAnimalSchema,
  retireIdentifierSchema,
  revertExitSchema,
} from './animals.js';
import { auditQuerySchema } from './audit.js';

describe('animalCodeSchema (RN-30)', () => {
  it('guarda el código en NFC y sin los espacios de la lista, con sus mayúsculas y ceros', () => {
    expect(animalCodeSchema.parse('  05-ña\t')).toBe('05-ña');
  });

  it('rechaza un código que solo tiene espacios', () => {
    expect(animalCodeSchema.safeParse('  \n').success).toBe(false);
  });
});

describe('exitAnimalSchema (ANI-04)', () => {
  it('acepta una venta con precio y comprador', () => {
    const parsed = exitAnimalSchema.parse({
      type: 'SALE',
      date: '2026-09-20',
      sale: { amount: '3500000', buyer: ' Don Rafael ' },
    });
    expect(parsed.sale).toEqual({ amount: '3500000', buyer: 'Don Rafael' });
  });

  it('deja pasar una venta sin precio: la API responde SALE_AMOUNT_REQUIRED', () => {
    expect(exitAnimalSchema.safeParse({ type: 'SALE', date: '2026-09-20' }).success).toBe(true);
  });

  it('rechaza datos de venta en una salida que no es venta', () => {
    const result = exitAnimalSchema.safeParse({
      type: 'DEATH',
      date: '2026-09-20',
      sale: { amount: '100' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['sale']);
  });

  it('rechaza un tipo desconocido y montos con puntos de miles', () => {
    expect(exitAnimalSchema.safeParse({ type: 'LOST', date: '2026-09-20' }).success).toBe(false);
    expect(
      exitAnimalSchema.safeParse({
        type: 'SALE',
        date: '2026-09-20',
        sale: { amount: '3.500.000' },
      }).success,
    ).toBe(false);
  });
});

describe('revertExitSchema y archiveAnimalSchema', () => {
  it('el código nuevo de la reversión es opcional y se limpia', () => {
    expect(revertExitSchema.parse({})).toEqual({});
    expect(revertExitSchema.parse({ newCode: ' 41 ' })).toEqual({ newCode: '41' });
  });

  it('archivar exige motivo', () => {
    expect(archiveAnimalSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(archiveAnimalSchema.parse({ reason: ' Registro duplicado ' })).toEqual({
      reason: 'Registro duplicado',
    });
  });
});

describe('motivos de retiro manuales (IDN-06)', () => {
  it('una persona no puede retirar con EXITED ni ARCHIVED: los pone el sistema', () => {
    for (const reason of ['EXITED', 'ARCHIVED']) {
      expect(retireIdentifierSchema.safeParse({ reason, date: '2026-09-20' }).success).toBe(false);
    }
    expect(retireIdentifierSchema.safeParse({ reason: 'LOST', date: '2026-09-20' }).success).toBe(
      true,
    );
  });
});

describe('auditQuerySchema (AUD-01)', () => {
  it('acepta la consulta por animal', () => {
    expect(auditQuerySchema.safeParse({ animalId: uuidv7() }).success).toBe(true);
  });

  it('no mezcla animalId con entity, y entityId necesita entity', () => {
    expect(auditQuerySchema.safeParse({ animalId: uuidv7(), entity: 'Lot' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ entityId: uuidv7() }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ entity: 'Lot', entityId: uuidv7() }).success).toBe(true);
  });

  it('desde M7 deja consultar gastos, ventas y avalúos (la ruta es solo del ADMIN), no los inicios de sesión', () => {
    for (const entity of ['Expense', 'Sale', 'Valuation']) {
      expect(auditQuerySchema.safeParse({ entity }).success).toBe(true);
    }
    expect(auditQuerySchema.safeParse({ entity: 'Session' }).success).toBe(false);
  });

  it('exige un rango de fechas en orden', () => {
    expect(auditQuerySchema.safeParse({ from: '2026-09-20', to: '2026-09-01' }).success).toBe(
      false,
    );
  });
});
