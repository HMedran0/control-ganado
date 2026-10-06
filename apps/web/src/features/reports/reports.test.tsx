import {
  DEFAULT_FARM_SETTINGS,
  PRODUCTION_SYSTEM,
  toIsoDate,
  type ChartsReport,
  type ExitsReport,
  type ProductionSystem,
} from '@hato/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../test/app-harness';
import { ChartsPage } from './charts/ChartsPage';
import { ExitsReportPage } from './HerdReports';
import { ReportsIndex } from './ReportsIndex';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const farm = (productionSystem: ProductionSystem) => ({
  id: 'f1',
  name: 'Finca La Esperanza',
  municipality: null,
  department: null,
  icaPremiseCode: null,
  version: 1,
  settings: { ...DEFAULT_FARM_SETTINGS, productionSystem },
});

const titles = () =>
  within(screen.getByRole('list', { name: 'Reportes disponibles' }))
    .getAllByRole('link')
    .map((link) => link.querySelector('.font-bold')?.textContent);

describe('Reportes: el orden del sistema productivo (CFG-03 CA1, M8b)', () => {
  it('doble propósito empieza por las gráficas, los partos y los nacimientos', async () => {
    await renderApp(<ReportsIndex />, () => json(farm(PRODUCTION_SYSTEM.DOBLE_PROPOSITO)));
    expect(await screen.findByText(/finca de doble propósito/i)).toBeVisible();
    expect(titles().slice(0, 3)).toEqual(['Gráficas', 'Partos próximos', 'Nacimientos']);
    expect(titles()).toContain('Reporte económico');
  });

  it('ceba empieza por el inventario, las salidas y el económico', async () => {
    await renderApp(<ReportsIndex />, () => json(farm(PRODUCTION_SYSTEM.LEVANTE_CEBA)));
    expect(await screen.findByText(/levante y ceba/i)).toBeVisible();
    expect(titles().slice(1, 4)).toEqual([
      'Inventario',
      'Vendidos y retirados',
      'Reporte económico',
    ]);
  });

  it('el reporte económico no aparece para el OPERATOR (RN-20)', async () => {
    await renderApp(<ReportsIndex />, () => json(farm(PRODUCTION_SYSTEM.LEVANTE_CEBA)), {
      session: { role: 'OPERATOR' },
    });
    expect(await screen.findByText(/levante y ceba/i)).toBeVisible();
    expect(titles()).not.toContain('Reporte económico');
    expect(titles().slice(1, 3)).toEqual(['Inventario', 'Vendidos y retirados']);
  });
});

const exits: ExitsReport = {
  from: toIsoDate('2026-01-01'),
  to: toIsoDate('2026-09-25'),
  byType: [{ type: 'SALE', count: 1 }],
  items: [
    {
      animal: { id: 'a1', code: '087', name: null, sex: 'MALE' },
      exitType: 'SALE',
      exitDate: toIsoDate('2026-03-12'),
      reason: null,
      salePrice: '3200000.00',
      buyer: 'Comprador',
    },
  ],
};

describe('Vendidos y retirados', () => {
  it('el ADMIN ve el precio de venta', async () => {
    await renderApp(<ExitsReportPage />, () => json(exits));
    expect(await screen.findByRole('columnheader', { name: 'Precio de venta' })).toBeVisible();
    expect(screen.getByText(/3\.200\.000/)).toBeVisible();
  });

  it('el OPERATOR no tiene la columna (RN-20)', async () => {
    const [sale] = exits.items;
    if (sale === undefined) throw new Error('Falta la salida de prueba.');
    const { salePrice: _price, buyer: _buyer, ...item } = sale;
    await renderApp(<ExitsReportPage />, () => json({ ...exits, items: [item] }), {
      session: { role: 'OPERATOR' },
    });
    expect(await screen.findByRole('link', { name: '087' })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: 'Precio de venta' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Comprador' })).toBeNull();
  });
});

const charts: ChartsReport = {
  today: toIsoDate('2026-09-25'),
  inventoryByMonth: [
    { month: '2026-08', on: toIsoDate('2026-08-31'), males: 100, females: 180, total: 280 },
    { month: '2026-09', on: toIsoDate('2026-09-25'), males: 102, females: 182, total: 284 },
  ],
  birthsByMonth: [
    { month: '2026-08', males: 3, females: 2 },
    { month: '2026-09', males: 0, females: 4 },
  ],
  byCategory: [
    { category: 'CALF_MALE', count: 20 },
    { category: 'COW', count: 90 },
  ],
};

describe('Gráficas (RPT-03)', () => {
  it('tres gráficas con su descripción y su tabla de datos', async () => {
    await renderApp(<ChartsPage />, () => json(charts));
    expect(
      await screen.findByRole('group', {
        name: 'Evolución del inventario: 280 animales en ago 2026 y 284 en sep 2026.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('group', {
        name: 'Nacimientos por mes y sexo en los últimos 12 meses: 9 en total.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'sep 2026: 4 nacimientos (4 hembras, 0 machos)' }),
    ).toBeVisible();
    expect(screen.getByRole('img', { name: 'Vaca: 90' })).toBeVisible();
    // Dos series: leyenda con nombre, nunca solo color.
    expect(screen.getByRole('list', { name: 'Leyenda' })).toHaveTextContent('HembrasMachos');
    expect(screen.getAllByText('Ver los datos')).toHaveLength(3);
    expect(screen.getByRole('table', { name: 'Nacimientos por mes y sexo' })).toBeInTheDocument();
  });
});
