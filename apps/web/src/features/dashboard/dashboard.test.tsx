import type { DashboardResponse, IsoDate } from '@hato/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../test/app-harness';
import { json } from '../../test/auth-harness';
import { HomeDashboard } from './HomeDashboard';

const d = (value: string) => value as IsoDate;

/** La finca de referencia el 25/09/2026, doble propósito (cifras de expected.ts). */
const ESPERANZA: DashboardResponse = {
  today: d('2026-09-25'),
  productionSystem: 'DOBLE_PROPOSITO',
  salesFocus: null,
  questions: ['WEANING', 'CALVING_INTERVAL', 'DRY_COWS', 'MILK_WITHDRAWAL'],
  herd: { total: 284, males: 96, females: 188, calvesMale: 38, calvesFemale: 36 },
  reproduction: {
    pregnant: 71,
    served: 16,
    calvingSoon: 9,
    calvingOverdue: 2,
    nextCalving: { animalId: 'a-069', code: '069', expectedCalvingDate: d('2026-08-21') },
  },
  births: { from: d('2026-01-01'), to: d('2026-09-25'), live: 90, males: 46, females: 44 },
  vaccines: { pending: 78, overdue: 6, due: 74, currentCycle: null },
  alerts: {
    vaccine_overdue: 6,
    vaccine_due: 74,
    calving_soon: 9,
    withdrawal: 2,
    unconfirmed_service: 3,
    calving_overdue: 2,
    low_gain: 5,
    weight_loss: 2,
  },
  forSale: { count: 14, sex: null },
  weaning: {
    bornFrom: d('2026-02-01'),
    bornTo: d('2026-02-28'),
    count: 9,
    weighed: 9,
    averageWeightKg: 60.8,
  },
  calvingInterval: {
    count: 62,
    females: 52,
    averageDays: 501,
    distribution: [
      { bucket: 'UNDER_365', count: 10 },
      { bucket: 'D365_399', count: 0 },
      { bucket: 'D400_439', count: 3 },
      { bucket: 'D440_499', count: 19 },
      { bucket: 'D500_PLUS', count: 30 },
    ],
  },
  dryCows: { count: 29 },
  milkWithdrawal: { count: 1 },
  investment: '36761389.00',
};

/** El Retiro, levante y ceba, que vende machos. */
const RETIRO: DashboardResponse = {
  ...ESPERANZA,
  productionSystem: 'LEVANTE_CEBA',
  salesFocus: 'MALES',
  questions: ['SALE_WEIGHT', 'LOW_GAIN_LOTS', 'DAYS_TO_SALE'],
  forSale: { count: 0, sex: 'MALE' },
  saleWeight: { monthEnd: d('2026-09-30'), reached: 6, thisMonth: 3, likelyReached: 2, later: 6 },
  lotGains: {
    belowThreshold: [
      {
        lotId: 'lote-b',
        name: 'Ceba B',
        animals: 2,
        averageGain: 0.181,
        averageThreshold: 0.3,
        lowGain: 2,
      },
    ],
    others: [],
  },
  daysToSale: { averageDays: 1089, animals: 9 },
};
delete (RETIRO as { weaning?: unknown }).weaning;
delete (RETIRO as { calvingInterval?: unknown }).calvingInterval;
delete (RETIRO as { dryCows?: unknown }).dryCows;
delete (RETIRO as { milkWithdrawal?: unknown }).milkWithdrawal;

const show = (body: DashboardResponse) =>
  renderApp(<HomeDashboard />, (url) => (url.includes('/dashboard') ? json(body) : json({})));

/** El enlace de una pregunta: la fila completa. */
const linkOf = (question: string) => screen.getByRole('link', { name: new RegExp(question) });

describe('Inicio — preguntas del día (RPT-01, CFG-03)', () => {
  it('doble propósito: primero las de cría y el retiro de leche, después las comunes', async () => {
    await show(ESPERANZA);
    const own = await screen.findByRole('region', { name: 'Para tu finca de doble propósito' });
    const questions = within(own)
      .getAllByText(/^¿/)
      .map((node) => node.textContent);
    expect(questions).toEqual([
      '¿Cuántos terneros se destetan este mes?',
      '¿Cuál es el intervalo entre partos?',
      '¿Cuántas vacas están horras?',
      '¿Cuáles están en retiro de leche?',
    ]);
    // Las de ceba no aparecen y las de leche de M9b todavía no existen (sin tarjetas vacías).
    expect(screen.queryByText(/peso de venta/)).not.toBeInTheDocument();
    expect(screen.queryByText(/en ordeño/)).not.toBeInTheDocument();
    expect(screen.getByText('Pesan 60,8 kg en promedio (9 pesados)')).toBeInTheDocument();
    expect(screen.getByText('501 d')).toBeInTheDocument();
  });

  it('cada cifra abre el listado o las Alertas con su filtro', async () => {
    await show(ESPERANZA);
    await screen.findByText('¿Cuántos animales hay?');
    expect(linkOf('¿Cuántos animales hay?')).toHaveAttribute('href', '/animals');
    expect(linkOf('¿Cuántas están preñadas?')).toHaveAttribute('href', '/animals?tags=PREGNANT');
    expect(linkOf('¿Cuáles paren pronto?')).toHaveAttribute(
      'href',
      '/animals?alerts=calving_soon&sort=calving',
    );
    expect(linkOf('¿Qué falta vacunar?')).toHaveAttribute(
      'href',
      '/alerts?types=vaccine_overdue%2Cvaccine_due',
    );
    expect(linkOf('¿Cuántos terneros se destetan')).toHaveAttribute(
      'href',
      '/animals?bornFrom=2026-02-01&bornTo=2026-02-28',
    );
    expect(linkOf('¿Cuántas vacas están horras?')).toHaveAttribute('href', '/animals?tags=DRY');
    expect(linkOf('¿Cuáles están en retiro de leche?')).toHaveAttribute(
      'href',
      '/animals?milkWithdrawal=true',
    );
    expect(linkOf('¿Cuántos nacieron este año?')).toHaveAttribute('href', '/reports/births');
    expect(linkOf('¿Cuáles están para venta?')).toHaveAttribute('href', '/animals?forSale=true');
    expect(linkOf('¿Cuánto hay invertido?')).toHaveAttribute('href', '/finance?tab=reporte');
    // El intervalo entre partos es un promedio: no tiene listado detrás.
    expect(screen.queryByRole('link', { name: /intervalo entre partos/ })).not.toBeInTheDocument();
  });

  it('la referencia de UPRA es solo texto, sin color de alerta', async () => {
    await show(ESPERANZA);
    const reference = await screen.findByText(/387 a 439 días/);
    expect(reference.className).not.toMatch(/alerta|aviso/);
    // El intervalo (501 d) está fuera de esa referencia y aun así no se pinta de rojo.
    expect(screen.getByText('501 d').className).not.toMatch(/text-alerta/);
  });

  it('el número de vacunas va en rojo solo si hay vencidas, y lo dice con palabras', async () => {
    await show(ESPERANZA);
    expect(await screen.findByText('78')).toHaveClass('text-alerta');
    expect(screen.getByText(/6 vencidas · 74 pendientes o próximas/)).toBeInTheDocument();
    await show({ ...ESPERANZA, vaccines: { pending: 3, overdue: 0, due: 3, currentCycle: null } });
    expect((await screen.findAllByText('3'))[0]).not.toHaveClass('text-alerta');
  });

  it('sin inversión en la respuesta (OPERATOR, VET) no hay pregunta de dinero', async () => {
    const { investment: _investment, ...operator } = ESPERANZA;
    await show(operator);
    await screen.findByText('¿Cuántos animales hay?');
    expect(screen.queryByText('¿Cuánto hay invertido?')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('levante y ceba: peso de venta medido y estimado por separado, lotes y días', async () => {
    await show(RETIRO);
    await screen.findByRole('region', { name: 'Para tu finca de levante y ceba' });
    expect(linkOf('¿Cuáles alcanzan el peso de venta este mes?')).toHaveAttribute(
      'href',
      '/animals?saleWeight=this_month',
    );
    expect(linkOf('¿Cuáles ya están en el peso de venta?')).toHaveAttribute(
      'href',
      '/animals?saleWeight=reached',
    );
    expect(linkOf('¿Cuáles posiblemente ya están en el peso?')).toHaveAttribute(
      'href',
      '/animals?saleWeight=likely_reached',
    );
    expect(
      screen.getByText('Según su ganancia ya deberían estar en el peso: pésalos para confirmar'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ceba B: 0,181 kg\/día/ })).toHaveAttribute(
      'href',
      '/alerts?types=low_gain&lotId=lote-b',
    );
    expect(screen.getByText('1.089 d')).toBeInTheDocument();
    // Disponibles para venta, centrados en lo que vende la finca (CFG-03 CA3).
    expect(linkOf('¿Cuáles están para venta?')).toHaveAttribute(
      'href',
      '/animals?forSale=true&sex=MALE',
    );
  });

  it('las alertas por tipo salen en el orden del sistema: pesos primero en ceba', async () => {
    await show(RETIRO);
    const panel = await screen.findByRole('complementary', { name: 'Alertas' });
    const groups = within(panel)
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent);
    expect(groups).toEqual(['Pesos', 'Vacunas', 'Retiros', 'Reproducción']);
    expect(within(panel).getByRole('link', { name: /Ganancia baja/ })).toHaveAttribute(
      'href',
      '/alerts?types=low_gain',
    );
  });

  it('si la API falla, lo dice y no muestra cifras', async () => {
    await renderApp(<HomeDashboard />, () => json({ code: 'INTERNAL' }, 500));
    expect(await screen.findByText('No pudimos cargar las preguntas del día')).toBeInTheDocument();
  });
});
