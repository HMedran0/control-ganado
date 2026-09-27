import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { networkError, NETWORK_ERROR_DETAIL } from '../../lib/api/errors';
import { fakeSession } from '../../test/auth-harness';
import { SessionGate } from './SessionGate';

describe('SessionGate', () => {
  it('muestra un estado de carga mientras restaura', () => {
    render(
      <SessionGate restore={() => new Promise(() => {})}>
        <p>Aplicación</p>
      </SessionGate>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Cargando…');
    expect(screen.queryByText('Aplicación')).not.toBeInTheDocument();
  });

  it('con sesión restaurada muestra la aplicación', async () => {
    render(
      <SessionGate restore={() => Promise.resolve(fakeSession())}>
        <p>Aplicación</p>
      </SessionGate>,
    );

    expect(await screen.findByText('Aplicación')).toBeInTheDocument();
  });

  it('con 401 (sin sesión) muestra la aplicación, y el router lleva al inicio de sesión', async () => {
    render(
      <SessionGate restore={() => Promise.resolve(null)}>
        <p>Aplicación</p>
      </SessionGate>,
    );

    expect(await screen.findByText('Aplicación')).toBeInTheDocument();
  });

  it('sin conexión NO muestra la aplicación: ofrece reintentar', async () => {
    const restore = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(fakeSession());
    render(
      <SessionGate restore={restore}>
        <p>Aplicación</p>
      </SessionGate>,
    );

    expect(await screen.findByRole('heading', { name: NETWORK_ERROR_DETAIL })).toBeInTheDocument();
    expect(screen.queryByText('Aplicación')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Aplicación')).toBeInTheDocument();
    expect(restore).toHaveBeenCalledTimes(2);
  });
});
