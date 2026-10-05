import { toIsoDate } from '@hato/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WeightChart } from './WeightChart';

const points = [
  { id: 'a', date: toIsoDate('2026-03-15'), kg: 260 },
  { id: 'b', date: toIsoDate('2026-06-15'), kg: 300 },
  { id: 'c', date: toIsoDate('2026-09-15'), kg: 340.5 },
];

describe('WeightChart (PES-02)', () => {
  it('resume la serie para lectores de pantalla y marca cada pesaje', () => {
    render(<WeightChart points={points} />);
    expect(
      screen.getByRole('group', {
        name: 'Evolución del peso: de 260 kg el 15/03/2026 a 340,5 kg el 15/09/2026, 3 pesajes.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('15/06/2026: 300 kg')).toBeInTheDocument();
  });

  it('al enfocar un punto con el teclado muestra su fecha y su peso', async () => {
    const user = userEvent.setup();
    render(<WeightChart points={points} />);
    await user.tab();
    expect(screen.getByText('15/03/2026 · 260 kg')).toBeInTheDocument();
    await user.tab();
    expect(screen.getByText('15/06/2026 · 300 kg')).toBeInTheDocument();
  });

  it('sin pesajes no dibuja nada; con uno, un punto', () => {
    const { container, rerender } = render(<WeightChart points={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WeightChart points={points.slice(0, 1)} />);
    expect(screen.getAllByLabelText(/kg$/)).toHaveLength(1);
  });
});
