import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo } from './Logo';

describe('Logo (marca Arreo)', () => {
  it('se lee «Arreo», con la «A» en la chapeta decorativa', () => {
    const { container } = render(<Logo />);
    expect(screen.getByText('Arreo')).toBeVisible();
    expect(container.textContent).toBe('AArreo');
    expect(container.textContent).not.toContain('Hato');
  });
});
