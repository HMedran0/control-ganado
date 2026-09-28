import type { AnimalLabels } from '@hato/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../test/app-harness';
import { json } from '../../../test/auth-harness';
import { LabelSheetPage } from './LabelSheetPage';

const label = (index: number) => ({
  id: `0190a000-0000-7000-8000-${String(index).padStart(12, '0')}`,
  code: `A-${index}`,
  name: index === 1 ? 'Canela' : null,
  sex: 'FEMALE' as const,
  visualTag: index === 1 ? '087' : null,
  din: null,
  rfid: index === 1 ? '170000123456789' : null,
  qrUrl: `http://localhost:5173/a/0190a000-0000-7000-8000-${String(index).padStart(12, '0')}`,
});

describe('LabelSheetPage (IDN-03 CA2)', () => {
  it('reparte las etiquetas en hojas con código, QR e identificadores', async () => {
    const body: AnimalLabels = {
      items: Array.from({ length: 22 }, (_, index) => label(index + 1)),
      truncated: false,
    };
    const { fetchMock } = await renderApp(
      <LabelSheetPage
        source={{ query: 'sex=FEMALE' }}
        paper="letter"
        format="label"
        onChange={vi.fn()}
      />,
      () => json(body),
    );

    expect(await screen.findByText('22 etiquetas · 2 hojas')).toBeVisible();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/animals/labels?sex=FEMALE');
    const first = screen.getByRole('article', { name: 'Etiqueta de A-1' });
    expect(within(first).getByRole('img', { name: 'QR de la ficha de A-1' })).toBeInTheDocument();
    expect(first).toHaveTextContent('Canela');
    expect(first).toHaveTextContent('Chapeta 087');
    expect(first).toHaveTextContent('Chip 170 000123456789');
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeEnabled();
  });

  it('una selección va por ids y avisa si se recortó', async () => {
    const { fetchMock } = await renderApp(
      <LabelSheetPage
        source={{ ids: 'a,b', query: 'sex=MALE' }}
        paper="a4"
        format="card"
        onChange={vi.fn()}
      />,
      () => json({ items: [label(1)], truncated: true }),
    );
    expect(await screen.findByText('1 etiqueta · 1 hoja')).toBeVisible();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/animals/labels?ids=a,b');
    expect(screen.getByText(/la hoja trae los primeros 1/)).toBeVisible();
  });
});
