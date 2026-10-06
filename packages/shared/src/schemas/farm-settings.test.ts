import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FARM_SETTINGS,
  farmSettingsPatchSchema,
  farmSettingsSchema,
  parseFarmSettings,
} from './farm-settings.js';

describe('DEFAULT_FARM_SETTINGS (03-modelo-datos.md §2.1)', () => {
  it('tiene los valores por defecto de la especificación', () => {
    expect(DEFAULT_FARM_SETTINGS).toEqual({
      gestationDays: 285,
      weaningAgeMonths: 7,
      minBreedingAgeMonths: 15,
      calvingAlertDays: 30,
      vaccineAlertDays: 15,
      unconfirmedServiceAlertDays: 90,
      overdueCalvingAlertDays: 15,
      calfCodePattern: '{YY}-{NNN}',
      rabiesRiskZone: true,
      pricePerKgByCategory: {},
      codeReuse: false,
      codeSuggestion: 'PATTERN',
      weightGainAlertKgPerDay: { YOUNG_MALE: 0.3 },
      weightLossAlertPercent: 5,
      weightGainAnchorMaxDays: 180,
      productionSystem: 'DOBLE_PROPOSITO',
      salesFocus: null,
      targetSaleWeightKg: { YOUNG_MALE: 450, ADULT_MALE: 450 },
    });
  });
});

describe('parámetros de peso (PES-05, ADR-015)', () => {
  it('acepta umbrales por categoría con hasta tres decimales', () => {
    const settings = parseFarmSettings({
      weightGainAlertKgPerDay: { YOUNG_MALE: 0.355, HEIFER: 0.25 },
    });
    expect(settings.weightGainAlertKgPerDay).toEqual({ YOUNG_MALE: 0.355, HEIFER: 0.25 });
  });

  it('rechaza más de tres decimales, categorías desconocidas y porcentajes fuera de rango', () => {
    expect(() => parseFarmSettings({ weightGainAlertKgPerDay: { YOUNG_MALE: 0.3005 } })).toThrow();
    expect(() => parseFarmSettings({ weightGainAlertKgPerDay: { BUEY: 0.3 } })).toThrow();
    expect(() => parseFarmSettings({ weightLossAlertPercent: 0 })).toThrow();
    expect(() => parseFarmSettings({ weightLossAlertPercent: 5.5 })).toThrow();
    expect(() => parseFarmSettings({ weightGainAnchorMaxDays: 400 })).toThrow();
  });
});

describe('numeración de la finca (ANI-10)', () => {
  it('acepta la numeración reutilizable con el menor número libre', () => {
    const settings = parseFarmSettings({ codeReuse: true, codeSuggestion: 'LOWEST_FREE' });
    expect(settings.codeReuse).toBe(true);
    expect(settings.codeSuggestion).toBe('LOWEST_FREE');
  });

  it('rechaza un modo de sugerencia desconocido', () => {
    expect(() => parseFarmSettings({ codeSuggestion: 'RANDOM' })).toThrowError();
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

describe('pricePerKgByCategory (ECO-03, M7)', () => {
  it('solo categorías de manejo y montos positivos', () => {
    const parse = (value: unknown) =>
      farmSettingsPatchSchema.safeParse({ pricePerKgByCategory: value }).success;
    expect(parse({ COW: '7800.00', YOUNG_MALE: '8200' })).toBe(true);
    expect(parse({})).toBe(true);
    expect(parse({ VACA: '7800.00' })).toBe(false);
    expect(parse({ COW: '7.800' })).toBe(false);
    expect(parse({ COW: '0' })).toBe(false);
  });
});

describe('sistema productivo y peso de venta (CFG-03, PES-06; M8a)', () => {
  it('una finca guardada antes de M8a toma doble propósito, sin enfoque de venta y 450 kg', () => {
    const settings = parseFarmSettings({ gestationDays: 290 });
    expect(settings.productionSystem).toBe('DOBLE_PROPOSITO');
    expect(settings.salesFocus).toBeNull();
    expect(settings.targetSaleWeightKg).toEqual({ YOUNG_MALE: 450, ADULT_MALE: 450 });
  });

  it('acepta los cinco sistemas y los tres enfoques, y vuelve a null el enfoque', () => {
    for (const productionSystem of [
      'CRIA',
      'LEVANTE_CEBA',
      'LECHERIA',
      'DOBLE_PROPOSITO',
      'CICLO_COMPLETO',
    ]) {
      expect(farmSettingsPatchSchema.safeParse({ productionSystem }).success).toBe(true);
    }
    for (const salesFocus of ['MALES', 'FEMALES', 'BOTH', null]) {
      expect(farmSettingsPatchSchema.safeParse({ salesFocus }).success).toBe(true);
    }
    expect(farmSettingsPatchSchema.safeParse({ productionSystem: 'CEBA' }).success).toBe(false);
    expect(farmSettingsPatchSchema.safeParse({ salesFocus: 'BULLS' }).success).toBe(false);
  });

  it('el peso objetivo es por categoría, en kilos enteros de 50 a 1.500', () => {
    const ok = farmSettingsPatchSchema.safeParse({
      targetSaleWeightKg: { YOUNG_MALE: 420, ADULT_MALE: 480, HEIFER: 380 },
    });
    expect(ok.success).toBe(true);
    for (const targetSaleWeightKg of [
      { YOUNG_MALE: 450.5 },
      { YOUNG_MALE: 49 },
      { YOUNG_MALE: 1501 },
      { NOVILLO: 450 },
    ]) {
      expect(farmSettingsPatchSchema.safeParse({ targetSaleWeightKg }).success).toBe(false);
    }
    // Sin peso para ninguna categoría: nadie tiene fecha estimada de venta.
    expect(farmSettingsPatchSchema.safeParse({ targetSaleWeightKg: {} }).success).toBe(true);
  });
});
