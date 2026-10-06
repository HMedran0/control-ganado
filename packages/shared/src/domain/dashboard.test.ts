import { describe, expect, it } from 'vitest';

import { PRODUCTION_SYSTEM, SALES_FOCUS, SEX } from '../enums.js';
import {
  DASHBOARD_QUESTION,
  alertGroupOrder,
  salesFocusSex,
  sortAlertGroups,
  systemQuestions,
} from './dashboard.js';

const Q = DASHBOARD_QUESTION;

describe('systemQuestions (CFG-03, 09 §4.1)', () => {
  it('cría: destete, intervalo entre partos y horras', () => {
    expect(systemQuestions(PRODUCTION_SYSTEM.CRIA)).toEqual([
      Q.WEANING,
      Q.CALVING_INTERVAL,
      Q.DRY_COWS,
    ]);
  });

  it('levante y ceba: peso de venta, lotes con ganancia baja y días para la venta', () => {
    expect(systemQuestions(PRODUCTION_SYSTEM.LEVANTE_CEBA)).toEqual([
      Q.SALE_WEIGHT,
      Q.LOW_GAIN_LOTS,
      Q.DAYS_TO_SALE,
    ]);
  });

  it('doble propósito, antes de M9b: las de cría más el retiro de leche', () => {
    expect(systemQuestions(PRODUCTION_SYSTEM.DOBLE_PROPOSITO)).toEqual([
      Q.WEANING,
      Q.CALVING_INTERVAL,
      Q.DRY_COWS,
      Q.MILK_WITHDRAWAL,
    ]);
  });

  it('lechería, antes de M9b: solo el retiro de leche (sin tarjetas vacías)', () => {
    expect(systemQuestions(PRODUCTION_SYSTEM.LECHERIA)).toEqual([Q.MILK_WITHDRAWAL]);
  });

  it('ciclo completo combina cría y ceba', () => {
    expect(systemQuestions(PRODUCTION_SYSTEM.CICLO_COMPLETO)).toEqual([
      ...systemQuestions(PRODUCTION_SYSTEM.CRIA),
      ...systemQuestions(PRODUCTION_SYSTEM.LEVANTE_CEBA),
    ]);
  });
});

describe('alertGroupOrder (CFG-03 CA1)', () => {
  it('cada sistema ordena los cuatro grupos, sin repetir ni omitir', () => {
    for (const system of Object.values(PRODUCTION_SYSTEM)) {
      expect([...alertGroupOrder(system)].sort()).toEqual([
        'reproduction',
        'vaccines',
        'weights',
        'withdrawal',
      ]);
    }
  });

  it('la ceba ve primero los pesos; la cría, la reproducción; la lechería, los retiros', () => {
    expect(alertGroupOrder(PRODUCTION_SYSTEM.LEVANTE_CEBA)[0]).toBe('weights');
    expect(alertGroupOrder(PRODUCTION_SYSTEM.CRIA)[0]).toBe('reproduction');
    expect(alertGroupOrder(PRODUCTION_SYSTEM.LECHERIA)[0]).toBe('withdrawal');
  });

  it('sortAlertGroups ordena sin perder datos ni tocar la lista original', () => {
    const groups = [
      { key: 'vaccines', n: 1 },
      { key: 'reproduction', n: 2 },
      { key: 'withdrawal', n: 3 },
      { key: 'weights', n: 4 },
    ] as const;
    expect(sortAlertGroups(groups, PRODUCTION_SYSTEM.LEVANTE_CEBA).map((g) => g.n)).toEqual([
      4, 1, 3, 2,
    ]);
    expect(groups[0].key).toBe('vaccines');
  });
});

describe('salesFocusSex (CFG-03 CA3)', () => {
  it('machos, hembras o ninguno', () => {
    expect(salesFocusSex(SALES_FOCUS.MALES)).toBe(SEX.MALE);
    expect(salesFocusSex(SALES_FOCUS.FEMALES)).toBe(SEX.FEMALE);
    expect(salesFocusSex(SALES_FOCUS.BOTH)).toBeNull();
    expect(salesFocusSex(null)).toBeNull();
  });
});
