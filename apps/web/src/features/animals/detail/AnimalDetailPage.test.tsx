import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../test/app-harness';
import { animalDetail, FIXTURE_ANIMAL_ID } from '../../../test/animal-fixture';
import { json } from '../../../test/auth-harness';
import { AnimalDetailPage } from './AnimalDetailPage';

function api(url: string): Response {
  if (url.includes('/audit')) {
    return json({
      items: [
        {
          id: '1',
          at: '2026-09-25T12:00:00.000Z',
          action: 'EXIT',
          entity: 'Animal',
          entityId: FIXTURE_ANIMAL_ID,
          entityLabel: '5',
          user: { id: 'u', name: 'Álvaro Pérez' },
          changes: [{ field: 'exitType', before: null, after: 'SALE' }],
        },
      ],
      nextCursor: null,
    });
  }
  if (url.includes(`/animals/${FIXTURE_ANIMAL_ID}`)) return json(animalDetail());
  return json({ items: [], nextCursor: null });
}

describe('Pestaña «Cambios» de la ficha (AUD-01 CA2)', () => {
  it('el ADMIN la ve de última y muestra los cambios en lenguaje de finca', async () => {
    await renderApp(
      <AnimalDetailPage
        id={FIXTURE_ANIMAL_ID}
        tab="cambios"
        previousIdentifier={undefined}
        onTabChange={vi.fn()}
      />,
      api,
    );
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.at(-1)).toHaveTextContent('Cambios');
    expect(await screen.findByText('Salida · animal 5')).toBeInTheDocument();
    expect(screen.getByText('Tipo de salida: Venta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar salida' })).toBeInTheDocument();
  });

  it('un operario no la tiene, ni entrando por la URL: abre Resumen', async () => {
    const { fetchMock } = await renderApp(
      <AnimalDetailPage
        id={FIXTURE_ANIMAL_ID}
        tab="cambios"
        previousIdentifier={undefined}
        onTabChange={vi.fn()}
      />,
      api,
      { session: { role: 'OPERATOR' } },
    );
    await screen.findAllByRole('tab');
    expect(screen.queryByRole('tab', { name: 'Cambios' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Registrar salida' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/audit'))).toBe(false);
  });
});
