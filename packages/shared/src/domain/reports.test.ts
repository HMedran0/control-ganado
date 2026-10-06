import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import { PRODUCTION_SYSTEM, SEX, type Sex } from '../enums.js';
import { REPORT_LABEL } from '../format/labels.js';
import { icaAgeGroup } from './age.js';
import { ICA_GROUPS_BY_SEX, REPORT, lastMonths, reportOrder, wasInHerdOn } from './reports.js';

const d = toIsoDate;

describe('reportOrder (CFG-03 CA1, M8b) [Validar]', () => {
  it('cada sistema trae todos los reportes una vez', () => {
    const all = Object.values(REPORT).sort();
    for (const system of Object.values(PRODUCTION_SYSTEM)) {
      expect([...reportOrder(system)].sort(), system).toEqual(all);
    }
  });

  it('la cría empieza por los partos; la ceba por el inventario y las salidas', () => {
    expect(reportOrder(PRODUCTION_SYSTEM.CRIA).slice(0, 2)).toEqual([
      REPORT.CALVINGS_UPCOMING,
      REPORT.BIRTHS,
    ]);
    expect(reportOrder(PRODUCTION_SYSTEM.LEVANTE_CEBA).slice(0, 3)).toEqual([
      REPORT.INVENTORY,
      REPORT.EXITS,
      REPORT.ECONOMIC,
    ]);
    expect(reportOrder(PRODUCTION_SYSTEM.LECHERIA)[0]).toBe(REPORT.CALVINGS_UPCOMING);
    expect(reportOrder(PRODUCTION_SYSTEM.CICLO_COMPLETO)[0]).toBe(REPORT.INVENTORY);
  });

  it('cada reporte tiene nombre y descripción', () => {
    for (const name of Object.values(REPORT)) {
      expect(REPORT_LABEL[name].title.length).toBeGreaterThan(3);
      expect(REPORT_LABEL[name].description.length).toBeGreaterThan(10);
    }
  });
});

describe('ICA_GROUPS_BY_SEX (08 §2.2)', () => {
  it('cubre todos los grupos que da icaAgeGroup, en orden de edad', () => {
    for (const sex of [SEX.FEMALE, SEX.MALE] as Sex[]) {
      const seen: string[] = [];
      for (let months = 0; months <= 240; months += 1) {
        const group = icaAgeGroup(sex, months);
        expect(ICA_GROUPS_BY_SEX[sex], `${sex} ${months}`).toContain(group);
        if (seen.at(-1) !== group) seen.push(group);
      }
      expect(seen).toEqual(ICA_GROUPS_BY_SEX[sex]);
    }
  });

  it('las hembras tienen 7 grupos y los machos 6', () => {
    expect(ICA_GROUPS_BY_SEX[SEX.FEMALE]).toHaveLength(7);
    expect(ICA_GROUPS_BY_SEX[SEX.MALE]).toHaveLength(6);
  });
});

describe('wasInHerdOn (RPT-03)', () => {
  const animal = { entryDate: d('2025-03-10'), exitDate: d('2026-02-15'), archived: false };

  it('desde el día que entró', () => {
    expect(wasInHerdOn(animal, d('2025-03-09'))).toBe(false);
    expect(wasInHerdOn(animal, d('2025-03-10'))).toBe(true);
  });

  it('hasta el día antes de salir: el día de la salida ya no está', () => {
    expect(wasInHerdOn(animal, d('2026-02-14'))).toBe(true);
    expect(wasInHerdOn(animal, d('2026-02-15'))).toBe(false);
  });

  it('sin salida, sigue; archivado, nunca', () => {
    expect(wasInHerdOn({ ...animal, exitDate: null }, d('2030-01-01'))).toBe(true);
    expect(wasInHerdOn({ ...animal, archived: true }, d('2025-06-01'))).toBe(false);
  });
});

describe('lastMonths', () => {
  it('los últimos meses hasta hoy; el mes en curso termina hoy', () => {
    expect(lastMonths(d('2026-09-25'), 3)).toEqual([
      { month: '2026-07', from: d('2026-07-01'), to: d('2026-07-31') },
      { month: '2026-08', from: d('2026-08-01'), to: d('2026-08-31') },
      { month: '2026-09', from: d('2026-09-01'), to: d('2026-09-25') },
    ]);
  });

  it('cruza el año y respeta febrero', () => {
    const months = lastMonths(d('2026-02-10'), 4);
    expect(months.map((month) => month.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(months[1]?.to).toBe('2025-12-31');
    expect(months[3]?.to).toBe('2026-02-10');
    expect(lastMonths(d('2024-03-01'), 2)[0]?.to).toBe('2024-02-29');
  });
});
