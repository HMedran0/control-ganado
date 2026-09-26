import { describe, expect, it } from 'vitest';

import { DEFAULT_FARM_SETTINGS, farmSettingsSchema, parseFarmSettings } from './farm-settings.js';

describe('DEFAULT_FARM_SETTINGS (03-modelo-datos.md §2.1)', () => {
  it('tiene los valores por defecto de la especificación', () => {
    expect(DEFAULT_FARM_SETTINGS).toEqual({
      gestationDays: 285,
      weaningAgeMonths: 7,
      minBreedingAgeMonths: 15,
      calvingAlertDays: 30,
      vaccineAlertDays: 15,
      unconfirmedServiceAlertDays: 90,
      calfCodePattern: '{YY}-{NNN}',
      rabiesRiskZone: true,
      pricePerKgByCategory: {},
    });
  });
});

describe('farmSettingsSchema', () => {
  it('completa los valores que falten', () => {
    expect(parseFarmSettings({ weaningAgeMonths: 9 })).toEqual({
      ...DEFAULT_FARM_SETTINGS,
      weaningAgeMonths: 9,
    });
  });

  it('rechaza claves desconocidas para que una errata no pase callada', () => {
    expect(() => parseFarmSettings({ weaningAgeMonth: 9 })).toThrowError();
    expect(() => parseFarmSettings({ ...DEFAULT_FARM_SETTINGS, extra: true })).toThrowError();
  });

  it('rechaza valores fuera de rango', () => {
    expect(() => parseFarmSettings({ weaningAgeMonths: 0 })).toThrowError();
    expect(() => parseFarmSettings({ weaningAgeMonths: 25 })).toThrowError();
    expect(() => parseFarmSettings({ gestationDays: 100 })).toThrowError();
    expect(() => parseFarmSettings({ unconfirmedServiceAlertDays: 0 })).toThrowError();
    expect(() => parseFarmSettings({ minBreedingAgeMonths: 5 })).toThrowError();
  });

  it('rechaza valores que no son enteros o no son del tipo correcto', () => {
    expect(() => parseFarmSettings({ weaningAgeMonths: 7.5 })).toThrowError();
    expect(() => parseFarmSettings({ rabiesRiskZone: 'sí' })).toThrowError();
    expect(() => parseFarmSettings({ calvingAlertDays: '30' })).toThrowError();
  });

  it('exige que el patrón de códigos tenga consecutivo (RN-28)', () => {
    expect(() => parseFarmSettings({ calfCodePattern: '{YY}-' })).toThrowError();
    expect(parseFarmSettings({ calfCodePattern: '{YYYY}-{N}' }).calfCodePattern).toBe('{YYYY}-{N}');
  });

  it('acepta precios por categoría como cadenas decimales', () => {
    const settings = parseFarmSettings({
      pricePerKgByCategory: { COW: '8500.00', YOUNG_MALE: '9200.00' },
    });
    expect(settings.pricePerKgByCategory.COW).toBe('8500.00');
  });

  it('acepta permitir una finca sin zona de riesgo de rabia', () => {
    expect(parseFarmSettings({ rabiesRiskZone: false }).rabiesRiskZone).toBe(false);
  });

  it('safeParse informa el campo que falla', () => {
    const resultado = farmSettingsSchema.safeParse({ weaningAgeMonths: 0 });
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0]?.path).toEqual(['weaningAgeMonths']);
    }
  });
});
