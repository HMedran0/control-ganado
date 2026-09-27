import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SearchBar } from '../../components/ui/SearchBar';
import { useRfidReader, type RfidReaderOptions } from './useRfidReader';

const CHIP = '170000123456789';

/** Reloj controlado: cada tecla avanza los milisegundos que se indiquen. */
function fakeClock() {
  let time = 1_000;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

type Clock = ReturnType<typeof fakeClock>;

/**
 * Teclea como lo haría un lector o una persona: `keydown` en el elemento con foco (o en el
 * documento) con `interval` ms entre teclas. Si el Enter no se absorbe, escribe el dígito en
 * el campo, como haría el navegador.
 */
function typeKeys(
  clock: Clock,
  keys: string,
  interval: number | readonly number[],
  target: Element = document.activeElement ?? document.body,
) {
  const gaps =
    typeof interval === 'number' ? Array<number>(keys.length + 1).fill(interval) : interval;
  let results: boolean[] = [];
  [...keys, 'Enter'].forEach((key, index) => {
    clock.advance(gaps[index] ?? 0);
    const notPrevented = fireEvent.keyDown(target, { key });
    if (key !== 'Enter' && target instanceof HTMLInputElement && notPrevented) {
      fireEvent.change(target, { target: { value: target.value + key } });
    }
    results = [...results, notPrevented];
  });
  return { enterPrevented: results.at(-1) === false };
}

function Reader(props: RfidReaderOptions) {
  useRfidReader(props);
  return null;
}

describe('useRfidReader', () => {
  it('lector a 25 ms por tecla: entrega la lectura aunque ningún campo tenga el foco', () => {
    const clock = fakeClock();
    const onRead = vi.fn();
    render(<Reader onRead={onRead} now={clock.now} />);

    const { enterPrevented } = typeKeys(clock, CHIP, 25, document.body);

    expect(onRead).toHaveBeenCalledWith(CHIP);
    expect(enterPrevented).toBe(true);
  });

  it('una lectura completa de ~400 ms también se detecta: se mide el intervalo, no el total', () => {
    const clock = fakeClock();
    const onRead = vi.fn();
    render(<Reader onRead={onRead} now={clock.now} />);

    typeKeys(clock, CHIP, 28, document.body);

    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('una persona a 120 ms por tecla no se confunde con el lector', () => {
    const clock = fakeClock();
    const onRead = vi.fn();
    render(<Reader onRead={onRead} now={clock.now} />);

    typeKeys(clock, CHIP, 120, document.body);

    expect(onRead).not.toHaveBeenCalled();
  });

  it('una pausa de 80 ms en medio de la ráfaga la invalida', () => {
    const clock = fakeClock();
    const onRead = vi.fn();
    render(<Reader onRead={onRead} now={clock.now} />);
    const gaps = Array<number>(16).fill(20);
    gaps[8] = 80;

    typeKeys(clock, CHIP, gaps, document.body);

    expect(onRead).not.toHaveBeenCalled();
  });

  it.each([
    ['14 dígitos', CHIP.slice(0, 14)],
    ['16 dígitos', `${CHIP}1`],
    ['una letra en medio', '1700001234A6789'],
  ])('%s no es una lectura', (_caso, keys) => {
    const clock = fakeClock();
    const onRead = vi.fn();
    render(<Reader onRead={onRead} now={clock.now} />);

    typeKeys(clock, keys, 20, document.body);

    expect(onRead).not.toHaveBeenCalled();
  });

  it('el intervalo máximo es configurable', () => {
    const clock = fakeClock();
    const onRead = vi.fn();
    render(<Reader onRead={onRead} now={clock.now} maxKeyIntervalMs={100} />);

    typeKeys(clock, CHIP, 80, document.body);

    expect(onRead).toHaveBeenCalledWith(CHIP);
  });

  it('desactivado no hace nada', () => {
    const clock = fakeClock();
    const onRead = vi.fn();
    render(<Reader onRead={onRead} now={clock.now} enabled={false} />);

    typeKeys(clock, CHIP, 20, document.body);

    expect(onRead).not.toHaveBeenCalled();
  });

  it('dentro de un campo de texto cualquiera no hace nada: la lectura queda en el campo', () => {
    const clock = fakeClock();
    const onRead = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <Reader onRead={onRead} now={clock.now} />
        <label>
          Observaciones <input type="text" />
        </label>
      </form>,
    );
    const field = screen.getByLabelText('Observaciones');
    field.focus();

    const { enterPrevented } = typeKeys(clock, CHIP, 20, field);

    expect(onRead).not.toHaveBeenCalled();
    expect(field).toHaveValue(CHIP);
    // El Enter sigue su curso normal: el hook no lo absorbe.
    expect(enterPrevented).toBe(false);
  });

  it('en un campo data-rfid-field: la lectura queda escrita, el Enter se absorbe y el foco avanza', () => {
    const clock = fakeClock();
    const onRead = vi.fn();
    render(
      <form>
        <Reader onRead={onRead} now={clock.now} />
        <label>
          Identificador <input type="text" data-rfid-field="" />
        </label>
        <label>
          Nombre <input type="text" />
        </label>
        <button type="submit">Guardar animal</button>
      </form>,
    );
    const field = screen.getByLabelText('Identificador');
    field.focus();

    const { enterPrevented } = typeKeys(clock, CHIP, 20, field);

    expect(field).toHaveValue(CHIP);
    expect(enterPrevented).toBe(true);
    expect(screen.getByLabelText('Nombre')).toHaveFocus();
    expect(onRead).not.toHaveBeenCalled();
  });

  it('un Enter tecleado a mano en un data-rfid-field sí envía el formulario', () => {
    const clock = fakeClock();
    render(
      <form>
        <Reader now={clock.now} />
        <label>
          Identificador <input type="text" data-rfid-field="" />
        </label>
      </form>,
    );
    const field = screen.getByLabelText('Identificador');
    field.focus();

    const { enterPrevented } = typeKeys(clock, '0457', 150, field);

    expect(enterPrevented).toBe(false);
  });
});

function Buscador({ onSearch }: { onSearch: (q: string, s: string) => void }) {
  const [value, setValue] = useState('');
  return <SearchBar value={value} onChange={setValue} onSearch={onSearch} shortcut />;
}

describe('SearchBar', () => {
  it('es un formulario de búsqueda con nombre, aunque la etiqueta no se vea', () => {
    render(<Buscador onSearch={vi.fn()} />);

    expect(screen.getByRole('search', { name: 'Buscar animal' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar animal' })).toBeInTheDocument();
  });

  it('con Enter busca lo escrito, sin espacios alrededor', () => {
    const onSearch = vi.fn();
    render(<Buscador onSearch={onSearch} />);
    const box = screen.getByRole('searchbox');

    fireEvent.change(box, { target: { value: '  26-045 ' } });
    fireEvent.submit(box);

    expect(onSearch).toHaveBeenCalledWith('26-045', 'teclado');
  });

  it('una lectura sin foco en ningún campo llena el buscador y busca', () => {
    const onSearch = vi.fn();
    render(<Buscador onSearch={onSearch} />);
    // El reloj real del hook: una ráfaga seguida, sin esperas, cabe en 50 ms por tecla.
    for (const key of [...CHIP, 'Enter']) fireEvent.keyDown(document.body, { key });

    expect(onSearch).toHaveBeenCalledWith(CHIP, 'lector');
    expect(screen.getByRole('searchbox')).toHaveValue(CHIP);
    expect(screen.getByRole('status')).toHaveTextContent(`Chip leído: ${CHIP}.`);
  });

  it('una lectura dentro del buscador busca como lector, no como texto', () => {
    const onSearch = vi.fn();
    render(<Buscador onSearch={onSearch} />);
    const box = screen.getByRole('searchbox');
    box.focus();
    for (const key of CHIP) {
      fireEvent.keyDown(box, { key });
      fireEvent.change(box, { target: { value: (box as HTMLInputElement).value + key } });
    }
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith(CHIP, 'lector');
  });

  it('la tecla «/» enfoca la búsqueda, pero no si se está escribiendo en otro campo', () => {
    render(
      <>
        <Buscador onSearch={vi.fn()} />
        <label>
          Observaciones <input type="text" />
        </label>
      </>,
    );
    const box = screen.getByRole('searchbox');

    fireEvent.keyDown(document.body, { key: '/' });
    expect(box).toHaveFocus();

    const notes = screen.getByLabelText('Observaciones');
    notes.focus();
    fireEvent.keyDown(notes, { key: '/' });
    expect(notes).toHaveFocus();
  });
});
