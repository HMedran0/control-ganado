import type { AnimalFinance, ExpensePreview } from '@hato/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp, sentBody } from '../../test/app-harness';
import { animalDetail } from '../../test/animal-fixture';
import { json } from '../../test/auth-harness';
import CostsTab from './CostsTab';
import { ExpenseForm, previewText } from './ExpenseForm';

const ref = (id: string, code: string) => ({ id, code, name: null });

describe('previewText: el reparto antes de guardar (ECO-02)', () => {
  const preview = (method: ExpensePreview['method'], amounts: string[]): ExpensePreview => ({
    dryRun: true,
    amount: '180001.00',
    method,
    allocations: amounts.map((amount, index) => ({
      animal: ref(`a${index}`, `10${index}`),
      amount,
    })),
  });

  it('partes iguales con residuo: dice quién lo lleva', () => {
    expect(previewText(preview('EQUAL', ['25717.00', '25714.00', '25714.00']))).toBe(
      '3 animales: $ 25.714 cada uno; 100 lleva $ 25.717, con el residuo para que la suma dé exacta.',
    );
  });

  it('exacto, por peso, un solo animal y general', () => {
    expect(previewText(preview('EQUAL', ['60000.00', '60000.00']))).toBe(
      '2 animales: $ 60.000 cada uno.',
    );
    expect(previewText(preview('BY_WEIGHT', ['57894.00', '60658.00', '61449.00']))).toBe(
      '3 animales, según el peso de cada uno. La suma da exactamente $ 180.001.',
    );
    expect(previewText(preview('DIRECT', ['180001.00']))).toBe('Todo a 100.');
    expect(previewText(preview('GENERAL', []))).toBe('Gasto general: no se carga a ningún animal.');
  });
});

const FINANCE: AnimalFinance = {
  animalId: 'animal-1',
  investment: {
    total: '2894473.00',
    byType: [
      { type: 'PURCHASE', amount: '2800000.00' },
      { type: 'FEED', amount: '9473.00' },
      { type: 'MEDICATION', amount: '85000.00' },
    ],
  },
  lines: [
    {
      expenseId: 'e1',
      date: '2026-09-10' as AnimalFinance['lines'][number]['date'],
      type: 'FEED',
      description: 'Bulto de sal mineralizada',
      method: 'EQUAL',
      amount: '4737.00',
      expenseAmount: '180000.00',
      animalCount: 38,
      lot: { id: 'l1', name: 'Paridas' },
    },
  ],
  valuations: [],
  sale: {
    id: 's1',
    animal: ref('animal-1', '5'),
    date: '2026-09-20' as AnimalFinance['lines'][number]['date'],
    amount: '3200000.00',
    buyer: 'Don Rafael',
    notes: null,
    voided: false,
    version: 1,
  },
  result: { basis: 'SALE', amount: '305527.00' },
};

describe('Pestaña Costos (ECO-05)', () => {
  it('inversión, venta, ganancia y la parte de cada gasto', async () => {
    await renderApp(<CostsTab animal={animalDetail({ status: 'SOLD' })} />, (url) =>
      url.includes('/finance') ? json(FINANCE) : json({}),
    );
    expect(await screen.findByText('$ 2.894.473')).toBeInTheDocument();
    expect(screen.getByText('Ganancia')).toBeInTheDocument();
    expect(screen.getByText('$ 305.527')).toBeInTheDocument();
    expect(screen.getByText(/Su parte de \$ 180\.000 entre 38/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corregir venta' })).toBeInTheDocument();
    // Un animal vendido no se avalúa.
    expect(screen.queryByRole('button', { name: 'Registrar avalúo' })).not.toBeInTheDocument();
  });

  it('pérdida en negativo', async () => {
    await renderApp(<CostsTab animal={animalDetail({ status: 'SOLD' })} />, (url) =>
      url.includes('/finance')
        ? json({ ...FINANCE, result: { basis: 'SALE', amount: '-100000.00' } })
        : json({}),
    );
    expect(await screen.findByText('Pérdida')).toBeInTheDocument();
    expect(screen.getByText('-$ 100.000')).toBeInTheDocument();
  });
});

describe('Registrar gasto (ECO-01, ECO-02)', () => {
  it('general: envía el reparto GENERAL y el monto como texto en pesos', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderApp(<ExpenseForm />, (url, init) =>
      url.includes('/lots')
        ? json({ items: [] })
        : init?.method === 'POST'
          ? json({ id: '019a0000-0000-7000-8000-000000000001', allocations: [] }, 201)
          : json({}),
    );
    await user.selectOptions(screen.getByLabelText('Tipo de gasto'), 'OTHER');
    await user.type(screen.getByLabelText('Monto'), '650000');
    await user.type(screen.getByLabelText('Descripción'), 'Arreglo de la cerca');
    await user.click(screen.getByRole('radio', { name: 'Gasto general' }));
    await user.click(screen.getByRole('button', { name: 'Registrar gasto' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true);
    });
    const post = fetchMock.mock.calls.findIndex(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(sentBody(fetchMock, post)).toMatchObject({
      type: 'OTHER',
      amount: '650000',
      description: 'Arreglo de la cerca',
      allocation: { method: 'GENERAL' },
    });
  });

  it('a un animal sin elegirlo: el error queda en el campo del animal', async () => {
    const user = userEvent.setup();
    await renderApp(<ExpenseForm />, () => json({ items: [] }));
    await user.selectOptions(screen.getByLabelText('Tipo de gasto'), 'VETERINARY');
    await user.type(screen.getByLabelText('Monto'), '120000');
    await user.type(screen.getByLabelText('Descripción'), 'Visita del veterinario');
    await user.click(screen.getByRole('button', { name: 'Registrar gasto' }));
    expect(await screen.findByText('El identificador no es válido.')).toBeInTheDocument();
  });
});
