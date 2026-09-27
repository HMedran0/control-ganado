import { toIsoDate, type IsoDate } from '@hato/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DateQuickPick } from './DateQuickPick';
import { SegmentedChoice } from './SegmentedChoice';

type Sexo = 'MALE' | 'FEMALE';

function Sexo({ onChange = vi.fn(), error }: { onChange?: (v: Sexo) => void; error?: string }) {
  const [value, setValue] = useState<Sexo | null>(null);
  return (
    <SegmentedChoice<Sexo>
      label="Sexo"
      options={[
        { value: 'MALE', label: 'Macho' },
        { value: 'FEMALE', label: 'Hembra' },
      ]}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      error={error}
    />
  );
}

describe('SegmentedChoice', () => {
  it('es un grupo de opciones con el nombre de su etiqueta visible', () => {
    render(<Sexo />);

    const group = screen.getByRole('radiogroup', { name: 'Sexo' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Macho' })).not.toBeChecked();
  });

  it('se elige con un toque', async () => {
    const onChange = vi.fn();
    render(<Sexo onChange={onChange} />);

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Hembra' }));

    expect(onChange).toHaveBeenCalledWith('FEMALE');
    expect(screen.getByRole('radio', { name: 'Hembra' })).toBeChecked();
  });

  it('se maneja con el teclado: Tab entra y las flechas cambian la opción', async () => {
    const onChange = vi.fn();
    render(<Sexo onChange={onChange} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Macho' }));
    // Radix mueve el foco en el siguiente ciclo y marca la opción solo si la flecha sigue
    // presionada: se suelta después, como hace una persona.
    await user.keyboard('{ArrowRight>}');
    await vi.waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Hembra' })).toHaveFocus();
    });
    await user.keyboard('{/ArrowRight}');

    expect(onChange).toHaveBeenLastCalledWith('FEMALE');
    expect(screen.getByRole('radio', { name: 'Hembra' })).toBeChecked();
  });

  it('muestra el error junto al grupo y lo enlaza', () => {
    render(<Sexo error="Elige el sexo de la cría." />);

    expect(screen.getByRole('radiogroup', { name: 'Sexo' })).toHaveAccessibleDescription(
      'Elige el sexo de la cría.',
    );
  });
});

function Fecha({ today, onChange = vi.fn() }: { today: IsoDate; onChange?: (d: IsoDate) => void }) {
  const [value, setValue] = useState(today);
  return (
    <DateQuickPick
      label="Fecha"
      today={today}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('DateQuickPick', () => {
  it('empieza en Hoy y lo confirma en formato de Colombia', () => {
    render(<Fecha today={toIsoDate('2026-09-25')} />);

    expect(screen.getByRole('radiogroup', { name: 'Fecha' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Hoy' })).toBeChecked();
    expect(screen.getByText('25/09/2026')).toBeInTheDocument();
  });

  it.each([
    ['2026-03-01', '2026-02-28'],
    ['2028-03-01', '2028-02-29'],
    ['2027-01-01', '2026-12-31'],
  ])('si hoy es %s, Ayer es %s', async (today, yesterday) => {
    const onChange = vi.fn();
    render(<Fecha today={toIsoDate(today)} onChange={onChange} />);

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Ayer' }));

    expect(onChange).toHaveBeenCalledWith(yesterday);
  });

  it('Otra fecha abre el campo de fecha, le pasa el foco y acepta una fecha pasada', async () => {
    const onChange = vi.fn();
    render(<Fecha today={toIsoDate('2026-09-25')} onChange={onChange} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Otra fecha' }));
    const input = screen.getByLabelText('Otra fecha', { selector: 'input' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('max', '2026-09-25');

    await user.clear(input);
    await user.type(input, '2026-09-10');

    expect(onChange).toHaveBeenLastCalledWith('2026-09-10');
    expect(screen.getByText('10/09/2026')).toBeInTheDocument();
  });

  it('rechaza una fecha futura con el mensaje del catálogo', async () => {
    const onChange = vi.fn();
    render(<Fecha today={toIsoDate('2026-09-25')} onChange={onChange} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Otra fecha' }));
    const input = screen.getByLabelText('Otra fecha', { selector: 'input' });
    await user.clear(input);
    await user.type(input, '2026-10-01');

    expect(screen.getByText('La fecha no puede ser posterior a hoy.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalledWith('2026-10-01');
  });
});
