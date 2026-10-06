import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../test/app-harness';
import { problem } from '../../test/auth-harness';
import { ExportPage } from './ExportPage';

/** Configuración → Exportar todos los datos (BAK-02, M8b). */
describe('ExportPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('descarga el ZIP con el nombre que manda la API', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:zip');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { fetchMock } = await renderApp(
      <ExportPage />,
      () =>
        new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="arreo-la-esperanza-2026-10-06.zip"',
          },
        }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Descargar todo (ZIP)' }));

    expect(await screen.findByText('Listo: el archivo quedó en tus descargas.')).toBeVisible();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/export/full');
    expect(created).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('el límite de 3 por hora se explica con el mensaje de la API', async () => {
    await renderApp(<ExportPage />, () =>
      problem(
        429,
        'EXPORT_LIMIT_REACHED',
        'Ya se exportaron los datos de la finca 3 veces en la última hora. Intenta de nuevo en 42 minutos.',
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Descargar todo (ZIP)' }));

    expect(await screen.findByText(/Intenta de nuevo en 42 minutos/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Descargar todo (ZIP)' })).toBeEnabled();
  });

  it('otra exportación en curso: pide esperar un minuto', async () => {
    await renderApp(<ExportPage />, () =>
      problem(429, 'EXPORT_IN_PROGRESS', 'Hay otra exportación en curso; intenta en un minuto.'),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Descargar todo (ZIP)' }));

    expect(
      await screen.findByText('Hay otra exportación en curso; intenta en un minuto.'),
    ).toBeVisible();
  });

  it('solo el ADMIN', async () => {
    await renderApp(<ExportPage />, () => new Response(null, { status: 500 }), {
      session: { role: 'OPERATOR' },
    });
    expect(screen.queryByRole('button', { name: 'Descargar todo (ZIP)' })).toBeNull();
  });
});
