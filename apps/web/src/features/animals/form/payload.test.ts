import { describe, expect, it } from 'vitest';

import {
  createBody,
  createResolver,
  emptyValues,
  fieldForPath,
  updateBody,
  updateResolver,
  type AnimalFormValues,
} from './payload';

const BREED = '0199a1b2-0000-7000-8000-000000000001';
const DAM = '0199a1b2-0000-7000-8000-000000000002';

function values(patch: Partial<AnimalFormValues> = {}): AnimalFormValues {
  return {
    ...emptyValues('2026-09-25'),
    code: '26-091',
    sex: 'FEMALE',
    breedId: BREED,
    birthDate: '2026-09-01',
    ...patch,
  };
}

async function resolve(resolver: ReturnType<typeof createResolver>, input: AnimalFormValues) {
  return resolver(input, undefined, { fields: {}, shouldUseNativeValidation: false });
}

describe('alta (ANI-01)', () => {
  it('un comprado con valor de compra, chip y peso inicial arma el cuerpo del contrato', () => {
    const body = createBody(
      values({
        origin: 'PURCHASED',
        entryDate: '2026-09-10',
        originDetail: 'Finca El Roble',
        purchasePrice: '1850000',
        rfid: '170000000000555',
        weightKg: '32.5',
        dam: { id: DAM, code: '045', name: null },
      }),
      true,
    );
    expect(body).toMatchObject({
      origin: 'PURCHASED',
      entryDate: '2026-09-10',
      purchasePrice: '1850000',
      damId: DAM,
      identifiers: [{ type: 'RFID', value: '170000000000555' }],
      initialWeight: { weightKg: 32.5, weighedOn: '2026-09-25', method: 'SCALE' },
    });
  });

  it('quien no es ADMIN nunca envía el valor de compra ni «Disponible para venta» (RN-20)', () => {
    const body = createBody(
      values({
        origin: 'PURCHASED',
        entryDate: '2026-09-10',
        purchasePrice: '1850000',
        forSale: true,
      }),
      false,
    );
    expect(body).not.toHaveProperty('purchasePrice');
    expect(body).not.toHaveProperty('forSale');
  });

  it('nacido en la finca: sin fecha de ingreso ni datos de compra', () => {
    const body = createBody(values({ entryDate: '2026-09-10', purchasePrice: '1' }), true);
    expect(body).not.toHaveProperty('entryDate');
    expect(body).not.toHaveProperty('purchasePrice');
  });

  it('el resolver valida con createAnimalSchema y cada error va a su campo', async () => {
    const result = await resolve(
      createResolver(true),
      values({
        sex: null,
        breedId: '',
        origin: 'PURCHASED',
        entryDate: '',
        rfid: '1',
        weightKg: '0',
      }),
    );
    expect(Object.keys(result.errors).sort()).toEqual(['breedId', 'entryDate', 'sex', 'weightKg']);
    expect(result.errors.breedId?.message).toBe('Elige la raza.');
  });

  it('un formulario válido entrega el cuerpo ya validado', async () => {
    const result = await resolve(createResolver(false), values({ code: ' 26-091 ' }));
    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({ code: '26-091', sex: 'FEMALE', breedId: BREED });
  });

  it('las rutas de error de la API vuelven al campo del formulario', () => {
    const body = createBody(values({ visualTag: '87', din: 'CO1' }), true);
    expect(fieldForPath('identifiers.1.value', body)).toBe('din');
    expect(fieldForPath('identifiers.0.value', body)).toBe('visualTag');
    expect(fieldForPath('initialWeight.weighedOn', body)).toBe('weighedOn');
    expect(fieldForPath('damId', body)).toBe('dam');
    expect(fieldForPath('code', body)).toBe('code');
  });
});

describe('edición (ANI-02)', () => {
  const initial = values({ name: 'Canela', notes: '' });

  it('solo viajan los campos que cambiaron, con la versión', () => {
    expect(
      updateBody({ ...initial, name: 'Canela II' }, initial, {
        version: 3,
        isAdmin: false,
        exited: false,
      }),
    ).toEqual({
      version: 3,
      name: 'Canela II',
    });
  });

  it('con salida registrada solo viajan las observaciones (RN-09)', () => {
    expect(
      updateBody({ ...initial, name: 'Otra', notes: 'Vendida' }, initial, {
        version: 2,
        isAdmin: true,
        exited: true,
      }),
    ).toEqual({ version: 2, notes: 'Vendida' });
  });

  it('sin cambios, el esquema lo dice como error general', async () => {
    const result = await resolve(
      updateResolver(initial, {
        version: 1,
        isAdmin: false,
        exited: false,
      }) as unknown as ReturnType<typeof createResolver>,
      initial,
    );
    expect(result.errors.root?.message).toBe('No hay nada que cambiar.');
  });
});
