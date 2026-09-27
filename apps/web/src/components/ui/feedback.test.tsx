import { toIsoDate } from '@hato/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Scale, Syringe } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/router-harness';
import { ConnectionBanner } from './ConnectionBanner';
import { Timeline } from './Timeline';
import { UNDO_TOAST_MS, UndoToastProvider, useUndoToast } from './UndoToast';

describe('Timeline', () => {
  it('lista los eventos en orden con fecha es-CO, autor y enlace al detalle', async () => {
    await renderWithRouter(
      <Timeline
        label="Historial de P-12"
        items={[
          {
            id: '1',
            icon: Syringe,
            title: 'Vacuna aftosa',
            date: toIsoDate('2026-09-03'),
            author: 'Dra. Paola',
            to: '/alerts',
          },
          { id: '2', icon: Scale, title: 'Pesaje · 452 kg', date: toIsoDate('2026-08-01') },
        ]}
      />,
    );

    const list = screen.getByRole('list', { name: 'Historial de P-12' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Vacuna aftosa' })).toBeInTheDocument();
    expect(screen.getByText('03/09/2026').closest('p')).toHaveTextContent(
      '03/09/2026 · Dra. Paola',
    );
  });

  it('un evento anulado sigue a la vista con la etiqueta y el motivo, sin enlace', async () => {
    await renderWithRouter(
      <Timeline
        label="Historial"
        items={[
          {
            id: '1',
            icon: Syringe,
            title: 'Vacuna aftosa',
            date: toIsoDate('2026-09-03'),
            to: '/alerts',
            voided: { reason: 'Se registró en el animal equivocado.' },
          },
        ]}
      />,
    );

    expect(screen.getByText('Anulado')).toBeInTheDocument();
    expect(screen.getByText('Motivo: Se registró en el animal equivocado.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

function Registrar({ onUndo }: { onUndo: () => void }) {
  const show = useUndoToast();
  return (
    <button type="button" onClick={() => show({ message: 'Vacuna registrada', onUndo })}>
      Registrar vacuna
    </button>
  );
}

describe('UndoToast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('muestra «Vacuna registrada · Deshacer» y Deshacer llama a onUndo', () => {
    const onUndo = vi.fn();
    render(
      <UndoToastProvider>
        <Registrar onUndo={onUndo} />
      </UndoToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Registrar vacuna' }));
    expect(screen.getAllByText('Vacuna registrada').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('se cierra solo a los 6 segundos', () => {
    vi.useFakeTimers();
    render(
      <UndoToastProvider>
        <Registrar onUndo={vi.fn()} />
      </UndoToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Registrar vacuna' }));
    act(() => {
      vi.advanceTimersByTime(UNDO_TOAST_MS - 100);
    });
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
  });
});

describe('ConnectionBanner', () => {
  it('sin red avisa con el texto de 06 §6 y lo retira al volver la señal', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<ConnectionBanner />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(status).toHaveTextContent(
      'Sin conexión. Lo que escribas se guardará cuando vuelva la señal.',
    );

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(status).toBeEmptyDOMElement();
  });
});
