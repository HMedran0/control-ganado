import { toIsoDate, type SessionView } from '@hato/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../test/app-harness';
import { json } from '../../test/auth-harness';
import { formatLastUse, formatSessionStart } from './sessions';
import { SessionsSection } from './SessionsSection';

const PHONE: SessionView = {
  id: '0190a000-0000-7000-8000-00000000a001',
  device: 'Chrome · Android',
  startedAt: '2026-09-02T14:00:00.000Z',
  lastUsedAt: '2026-09-28T15:00:00.000Z',
  current: true,
};
const LAPTOP: SessionView = {
  id: '0190a000-0000-7000-8000-00000000a002',
  device: 'Edge · Windows',
  startedAt: '2026-08-14T14:00:00.000Z',
  lastUsedAt: '2026-09-25T15:00:00.000Z',
  current: false,
};
const TABLET: SessionView = {
  ...LAPTOP,
  id: '0190a000-0000-7000-8000-00000000a003',
  device: 'Safari · iOS',
};

describe('formato de las sesiones', () => {
  const today = toIsoDate('2026-09-28');

  it('inicio con la fecha de la finca', () => {
    // 02:00 del 3 de septiembre en UTC es todavía el 2 en Bogotá.
    expect(formatSessionStart('2026-09-03T02:00:00.000Z')).toBe('Desde 02/09/2026');
  });

  it('último uso relativo hasta una semana, después con fecha', () => {
    expect(formatLastUse('2026-09-28T15:00:00.000Z', today)).toBe('usada hoy');
    expect(formatLastUse('2026-09-27T15:00:00.000Z', today)).toBe('usada ayer');
    expect(formatLastUse('2026-09-25T15:00:00.000Z', today)).toBe('usada hace 3 días');
    expect(formatLastUse('2026-09-14T15:00:00.000Z', today)).toBe('usada el 14/09/2026');
  });
});

describe('SessionsSection (AUT-11, 06 §5.9)', () => {
  it('marca «Este equipo» sin botón propio y ofrece cerrar las demás', async () => {
    await renderApp(<SessionsSection />, () => json({ items: [PHONE, LAPTOP] }));

    const list = await screen.findByRole('list', { name: 'Sesiones abiertas' });
    const [phone, laptop] = within(list).getAllByRole('listitem');
    expect(phone).toHaveTextContent('Chrome · AndroidEste equipo');
    expect(within(phone!).queryByRole('button')).toBeNull();
    expect(
      within(laptop!).getByRole('button', { name: 'Cerrar sesión en este equipo' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cerrar las demás sesiones' })).toBeVisible();
  });

  it('cerrar un equipo pide confirmación y llama a la API con su sesión', async () => {
    const { fetchMock } = await renderApp(<SessionsSection />, (url) =>
      url.endsWith('/revoke')
        ? json({ ok: true, current: false }, 201)
        : json({ items: [PHONE, LAPTOP] }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión en este equipo' }));
    const dialog = screen.getByRole('dialog', { name: '¿Cerrar la sesión en Edge · Windows?' });
    expect(dialog).toHaveTextContent('Tendrás que volver a entrar en ese equipo.');
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByText('Se cerró la sesión en Edge · Windows.')).toBeVisible();
    const urls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(urls).toContain(`/api/v1/auth/sessions/${LAPTOP.id}/revoke`);
  });

  it('«Cerrar las demás» cuenta los equipos y confirma cuántas cerró', async () => {
    await renderApp(<SessionsSection />, (url) =>
      url.endsWith('/revoke-others')
        ? json({ revoked: 2 }, 201)
        : json({ items: [PHONE, LAPTOP, TABLET] }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Cerrar las demás sesiones' }));
    const dialog = screen.getByRole('dialog', { name: '¿Cerrar las demás sesiones?' });
    expect(dialog).toHaveTextContent('los otros 2 equipos');
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar las demás sesiones' }));

    expect(await screen.findByText('Se cerraron 2 sesiones.')).toBeVisible();
  });

  it('con una sola sesión no ofrece cerrar las demás', async () => {
    await renderApp(<SessionsSection />, () => json({ items: [PHONE] }));
    await screen.findByRole('list', { name: 'Sesiones abiertas' });
    expect(screen.queryByRole('button', { name: 'Cerrar las demás sesiones' })).toBeNull();
  });
});
