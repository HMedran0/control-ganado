import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NumberField } from './NumberField';
import { Stepper } from './Stepper';

function Campo({
  initial = null,
  onChange = vi.fn(),
  ...props
}: {
  initial?: string | null;
  onChange?: (v: string | null) => void;
  unit?: string;
  currency?: boolean;
  maxDecimals?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberField
        label={props.currency === true ? 'Valor de compra' : 'Peso (kg)'}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        {...props}
      />
      <button type="button">Otro campo</button>
    </>
  );
}

describe('NumberField', () => {
  it('abre el teclado numérico y muestra la unidad', () => {
    render(<Campo unit="kg" maxDecimals={1} />);

    const input = screen.getByLabelText('Peso (kg)');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('«452,5» se interpreta como 452.5 (cadena, nunca number)', async () => {
    const onChange = vi.fn();
    render(<Campo unit="kg" maxDecimals={1} onChange={onChange} />);

    await userEvent.setup().type(screen.getByLabelText('Peso (kg)'), '452,5');

    expect(onChange).toHaveBeenLastCalledWith('452.5');
    expect(typeof onChange.mock.lastCall?.[0]).toBe('string');
  });

  it('«1.250.000» se interpreta como 1250000 y al salir se ve con puntos de miles', async () => {
    const onChange = vi.fn();
    render(<Campo currency onChange={onChange} />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Valor de compra');

    await user.type(input, '1250000');
    expect(onChange).toHaveBeenLastCalledWith('1250000');
    await user.tab();
    expect(input).toHaveValue('1.250.000');

    await user.clear(input);
    await user.type(input, '1.250.000');
    expect(onChange).toHaveBeenLastCalledWith('1250000');
  });

  it('en pesos usa teclado numérico sin decimales y muestra el signo $', () => {
    render(<Campo currency />);
    expect(screen.getByLabelText('Valor de compra')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('muestra el valor inicial formateado en es-CO', () => {
    render(<Campo initial="1250.5" unit="kg" maxDecimals={2} />);
    expect(screen.getByLabelText('Peso (kg)')).toHaveValue('1.250,5');
  });

  it('un texto que no es número se conserva y explica cómo escribirlo', async () => {
    const onChange = vi.fn();
    render(<Campo unit="kg" maxDecimals={1} onChange={onChange} />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Peso (kg)');

    await user.type(input, 'cuatro');
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue('cuatro');
    expect(input).toHaveAccessibleDescription('Escribe un número, por ejemplo 452,5.');
  });

  it('avisa si sobran decimales', async () => {
    render(<Campo unit="kg" maxDecimals={1} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Peso (kg)'), '452,55');
    await user.tab();

    expect(screen.getByText('Usa como máximo 1 decimal.')).toBeInTheDocument();
  });

  it('vacío es null', async () => {
    const onChange = vi.fn();
    render(<Campo initial="32" unit="kg" onChange={onChange} />);

    await userEvent.setup().clear(screen.getByLabelText('Peso (kg)'));

    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

function Crias() {
  const [value, setValue] = useState(1);
  return <Stepper label="Crías" value={value} onChange={setValue} min={1} max={3} />;
}

describe('Stepper', () => {
  it('suma y resta dentro de los límites, y deshabilita el botón en cada límite', async () => {
    render(<Crias />);
    const user = userEvent.setup();
    const menos = screen.getByRole('button', { name: 'Quitar uno (Crías)' });
    const mas = screen.getByRole('button', { name: 'Agregar uno (Crías)' });

    expect(screen.getByRole('group', { name: 'Crías' })).toBeInTheDocument();
    expect(menos).toBeDisabled();

    await user.click(mas);
    await user.click(mas);
    expect(screen.getByRole('status')).toHaveTextContent('3');
    expect(mas).toBeDisabled();

    await user.click(menos);
    expect(screen.getByRole('status')).toHaveTextContent('2');
  });
});
