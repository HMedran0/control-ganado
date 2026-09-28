import { toIsoDate } from '@hato/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../test/app-harness';
import { animalDetail, FIXTURE_ANIMAL_ID } from '../../../test/animal-fixture';
import { json, problem } from '../../../test/auth-harness';
import { CodeHistoryBanner } from './CodeHistoryBanner';
import { LifecycleActions } from './Lifecycle';

const HOLDER = '0199a1b2-0000-7000-8000-000000000041';

/** Cuerpos de los POST que llegaron a la ruta. */
function posts(fetchMock: ReturnType<typeof vi.fn>, path: string): unknown[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        String(url).includes(path) && (init as RequestInit | undefined)?.method === 'POST',
    )
    .map(([, init]) => {
      const body = (init as RequestInit).body;
      return JSON.parse(typeof body === 'string' ? body : 'null') as unknown;
    });
}

describe('Salida (ANI-04)', () => {
  it('venta: envía precio y comprador y avisa al terminar', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { fetchMock } = await renderApp(
      <LifecycleActions animal={animalDetail()} onDone={onDone} />,
      (url) =>
        url.includes('/exit')
          ? json({ ...animalDetail({ status: 'SOLD' }), warnings: [] }, 201)
          : json({}),
    );
    await user.click(screen.getByRole('button', { name: 'Registrar salida' }));
    await user.type(screen.getByLabelText('Precio de venta'), '3500000');
    await user.type(screen.getByLabelText('Comprador'), 'Don Rafael');
    await user.click(screen.getAllByRole('button', { name: 'Registrar salida' }).at(-1)!);

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith({ message: 'Salida de 5 registrada.', warnings: [] });
    });
    expect(posts(fetchMock, '/exit')[0]).toMatchObject({
      type: 'SALE',
      sale: { amount: '3500000', buyer: 'Don Rafael' },
    });
  });

  it('venta sin precio: SALE_AMOUNT_REQUIRED queda junto al campo', async () => {
    const user = userEvent.setup();
    await renderApp(<LifecycleActions animal={animalDetail()} onDone={vi.fn()} />, (url) =>
      url.includes('/exit')
        ? problem(422, 'SALE_AMOUNT_REQUIRED', 'Indica el precio de venta.')
        : json({}),
    );
    await user.click(screen.getByRole('button', { name: 'Registrar salida' }));
    await user.click(screen.getAllByRole('button', { name: 'Registrar salida' }).at(-1)!);
    expect(await screen.findByText('Indica el precio de venta.')).toBeInTheDocument();
  });

  it('en retiro: pide confirmar la venta antes de guardar (RN-22)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderApp(
      <LifecycleActions
        animal={animalDetail({ withdrawalUntil: toIsoDate('2099-01-01') })}
        onDone={vi.fn()}
      />,
      (url) => (url.includes('/exit') ? json({ ...animalDetail(), warnings: [] }, 201) : json({})),
    );
    await user.click(screen.getByRole('button', { name: 'Registrar salida' }));
    expect(screen.getByText(/Está en retiro de medicamento hasta el 01\/01\/2099/)).toBeVisible();
    await user.type(screen.getByLabelText('Precio de venta'), '100');
    await user.click(screen.getByLabelText('Confirmo la salida aunque esté en retiro'));
    await user.click(screen.getAllByRole('button', { name: 'Registrar salida' }).at(-1)!);
    await waitFor(() => {
      expect(posts(fetchMock, '/exit')[0]).toMatchObject({ confirmWithdrawal: true });
    });
  });
});

describe('Revertir salida (ANI-04 CA5, IDN-06 CA3)', () => {
  it('CODE_REASSIGNED: enlaza al animal que tiene el número y pide un código nuevo', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    let attempt = 0;
    const sold = animalDetail({
      status: 'SOLD',
      exit: { type: 'SALE', date: toIsoDate('2026-03-12'), reason: null },
    });
    const { fetchMock } = await renderApp(
      <LifecycleActions animal={sold} onDone={onDone} />,
      (url) => {
        if (url.includes('/next-code')) return json({ code: '17' });
        if (!url.includes('/revert-exit')) return json({});
        attempt += 1;
        return attempt === 1
          ? problem(
              409,
              'CODE_REASSIGNED',
              'El código 5 ya lo tiene el animal activo 5. Asígnale un código nuevo para revertir la salida.',
              { context: { animalId: HOLDER, animalCode: '5' } },
            )
          : json({ ...animalDetail({ code: '17' }), warnings: [] }, 201);
      },
    );

    await user.click(screen.getByRole('button', { name: 'Revertir salida' }));
    expect(screen.getByText(/Se anula la venta del 12\/03\/2026/)).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Revertir salida' }).at(-1)!);

    expect(await screen.findByRole('link', { name: 'Abrir la ficha de 5' })).toHaveAttribute(
      'href',
      `/animals/${HOLDER}`,
    );
    await user.click(await screen.findByRole('button', { name: 'Usar el 17' }));
    expect(screen.getByLabelText('Código nuevo')).toHaveValue('17');
    await user.click(screen.getAllByRole('button', { name: 'Revertir salida' }).at(-1)!);

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith({ message: '5 volvió al inventario.', warnings: [] });
    });
    expect(posts(fetchMock, '/revert-exit')).toEqual([{}, { newCode: '17' }]);
  });
});

describe('Archivo y restauración (ANI-03)', () => {
  it('archivar exige motivo y lo envía', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderApp(
      <LifecycleActions animal={animalDetail()} onDone={vi.fn()} />,
      (url) =>
        url.includes('/archive') ? json({ ...animalDetail(), warnings: [] }, 201) : json({}),
    );
    await user.click(screen.getByRole('button', { name: 'Archivar' }));
    await user.click(screen.getByRole('button', { name: 'Archivar animal' }));
    expect(await screen.findByText('Escribe el motivo (mínimo 3 caracteres).')).toBeVisible();
    await user.type(screen.getByLabelText('Motivo'), 'Registro duplicado');
    await user.click(screen.getByRole('button', { name: 'Archivar animal' }));
    await waitFor(() => {
      expect(posts(fetchMock, '/archive')).toEqual([{ reason: 'Registro duplicado' }]);
    });
  });

  it('un archivado solo ofrece restaurar', async () => {
    await renderApp(
      <LifecycleActions
        animal={animalDetail({
          status: 'ARCHIVED',
          archive: { archivedAt: '2026-09-25T12:00:00.000Z', reason: 'Duplicado' },
        })}
        onDone={vi.fn()}
      />,
      () => json({}),
    );
    expect(screen.getByRole('button', { name: 'Restaurar animal' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Archivar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar salida' })).not.toBeInTheDocument();
  });
});

describe('Número anterior (ANI-11)', () => {
  it('animal activo: quién tuvo antes su número, con enlace', async () => {
    await renderApp(
      <CodeHistoryBanner
        animal={animalDetail({
          codeHistory: {
            previousHolder: {
              animalId: HOLDER,
              code: '5',
              status: 'SOLD',
              exitDate: toIsoDate('2026-03-12'),
            },
            currentHolder: null,
          },
        })}
      />,
      () => json({}),
    );
    expect(
      screen.getByText('Este número lo tuvo antes 5 · vendido el 12/03/2026'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir la ficha de 5' })).toHaveAttribute(
      'href',
      `/animals/${HOLDER}`,
    );
  });

  it('animal que salió: quién lo tiene hoy', async () => {
    await renderApp(
      <CodeHistoryBanner
        animal={animalDetail({
          id: FIXTURE_ANIMAL_ID,
          status: 'SOLD',
          codeHistory: {
            previousHolder: null,
            currentHolder: { animalId: HOLDER, code: '05', status: 'ACTIVE', exitDate: null },
          },
        })}
      />,
      () => json({}),
    );
    expect(screen.getByText('Su número 5 lo tiene hoy otro animal')).toBeInTheDocument();
  });
});
