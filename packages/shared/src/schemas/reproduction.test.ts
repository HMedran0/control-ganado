import { describe, expect, it } from 'vitest';

import { uuidv7 } from '../id.js';
import { calvingSchema, createPregnancySchema, updatePregnancySchema } from './reproduction.js';

const damId = uuidv7();

describe('createPregnancySchema (REP-01, REP-02 CA3)', () => {
  it('servicio: fecha y método', () => {
    expect(
      createPregnancySchema.safeParse({ damId, serviceDate: '2026-01-12', method: 'AI' }).success,
    ).toBe(true);
    const noMethod = createPregnancySchema.safeParse({ damId, serviceDate: '2026-01-12' });
    expect(noMethod.success).toBe(false);
  });

  it('preñez confirmada sin servicio: meses y fecha de la palpación', () => {
    expect(
      createPregnancySchema.safeParse({ damId, gestationMonths: 4, diagnosisDate: '2026-09-20' })
        .success,
    ).toBe(true);
    expect(createPregnancySchema.safeParse({ damId, gestationMonths: 4 }).success).toBe(false);
    expect(
      createPregnancySchema.safeParse({ damId, gestationMonths: 10, diagnosisDate: '2026-09-20' })
        .success,
    ).toBe(false);
  });

  it('una sola de las dos formas, y toro de la finca o referencia externa, no ambos', () => {
    expect(
      createPregnancySchema.safeParse({
        damId,
        serviceDate: '2026-01-12',
        method: 'AI',
        gestationMonths: 3,
        diagnosisDate: '2026-04-12',
      }).success,
    ).toBe(false);
    expect(createPregnancySchema.safeParse({ damId }).success).toBe(false);
    expect(
      createPregnancySchema.safeParse({
        damId,
        serviceDate: '2026-01-12',
        method: 'AI',
        sireId: uuidv7(),
        sireExternalRef: 'Pajilla 123',
      }).success,
    ).toBe(false);
  });

  it('el id del cliente debe ser UUIDv7 (ADR-012)', () => {
    const base = { damId, serviceDate: '2026-01-12', method: 'AI' };
    expect(createPregnancySchema.safeParse({ ...base, id: uuidv7() }).success).toBe(true);
    expect(
      createPregnancySchema.safeParse({ ...base, id: '0b6f3d8e-1c2a-4b7e-9d10-2f3a4b5c6d7e' })
        .success,
    ).toBe(false);
  });
});

describe('calvingSchema (REP-04)', () => {
  const base = { damId, date: '2026-09-20', calvingType: 'NORMAL' };

  it('de 1 a 3 crías', () => {
    const calf = { sex: 'MALE', health: 'ALIVE' };
    expect(calvingSchema.safeParse({ ...base, calves: [] }).success).toBe(false);
    expect(calvingSchema.safeParse({ ...base, calves: [calf, calf, calf] }).success).toBe(true);
    expect(calvingSchema.safeParse({ ...base, calves: [calf, calf, calf, calf] }).success).toBe(
      false,
    );
  });

  it('una cría muerta al nacer no lleva código, id ni identificadores (REP-04 CA4)', () => {
    const stillborn = { sex: 'FEMALE', health: 'STILLBORN' };
    expect(calvingSchema.safeParse({ ...base, calves: [stillborn] }).success).toBe(true);
    expect(
      calvingSchema.safeParse({ ...base, calves: [{ ...stillborn, code: '26-001' }] }).success,
    ).toBe(false);
    expect(
      calvingSchema.safeParse({
        ...base,
        calves: [{ ...stillborn, identifiers: [{ type: 'VISUAL_TAG', value: '1' }] }],
      }).success,
    ).toBe(false);
  });

  it('el código de la cría es opcional y se limpia como el de cualquier animal', () => {
    const parsed = calvingSchema.parse({
      ...base,
      calves: [
        { sex: 'MALE', health: 'ALIVE', code: ' 26-045 ' },
        { sex: 'MALE', health: 'WEAK' },
      ],
    });
    expect(parsed.calves.map((calf) => calf.code)).toEqual(['26-045', undefined]);
  });
});

describe('updatePregnancySchema', () => {
  it('exige version y algo que cambiar', () => {
    expect(updatePregnancySchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updatePregnancySchema.safeParse({ notes: 'x' }).success).toBe(false);
    expect(
      updatePregnancySchema.safeParse({ version: 1, expectedCalvingDate: '2026-10-25' }).success,
    ).toBe(true);
  });
});
