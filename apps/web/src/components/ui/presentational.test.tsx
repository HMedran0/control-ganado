import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Scale } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/router-harness';
import { AlertBanner } from './AlertBanner';
import { Chapeta } from './Chapeta';
import { EmptyState } from './EmptyState';
import { QuestionRow } from './QuestionRow';
import { Tag } from './Tag';

describe('Chapeta', () => {
  it('es una imagen con nombre «Chapeta <código>» y no lee el código dos veces', () => {
    render(<Chapeta code="26-045" />);

    const chapeta = screen.getByRole('img', { name: 'Chapeta 26-045' });
    expect(chapeta).toBeInTheDocument();
    // El código dibujado está oculto para lectores de pantalla.
    expect(screen.getByText('26-045')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['s', 44],
    ['m', 72],
    ['l', 96],
  ] as const)('tamaño %s mide %i px de ancho', (size, width) => {
    render(<Chapeta code="P-12" size={size} />);
    expect(screen.getByRole('img')).toHaveStyle({ width: `${width}px` });
  });

  it('achica la letra de los códigos largos para que quepan', () => {
    render(
      <>
        <Chapeta code="P-12" size="s" />
        <Chapeta code="26-045" size="s" />
      </>,
    );
    const [short, long] = screen.getAllByText(/P-12|26-045/);
    expect(parseFloat(long!.style.fontSize)).toBeLessThan(parseFloat(short!.style.fontSize));
  });

  it('si el animal salió, agrega la etiqueta y NO tacha el código', () => {
    render(<Chapeta code="26-045" exitLabel="Vendido" />);

    expect(screen.getByText('Vendido')).toBeInTheDocument();
    const code = screen.getByText('26-045');
    expect(code.className).not.toMatch(/line-through/);
    expect(getComputedStyle(code).textDecorationLine).not.toBe('line-through');
  });
});

describe('Tag', () => {
  it('siempre muestra su texto, con ícono decorativo opcional', () => {
    render(
      <Tag tone="info" icon={Scale}>
        Preñada
      </Tag>,
    );
    expect(screen.getByText('Preñada')).toBeInTheDocument();
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('AlertBanner', () => {
  it('dice qué pasa y ofrece la acción como enlace', async () => {
    await renderWithRouter(
      <AlertBanner
        tone="alerta"
        title="Aftosa vencida hace 6 días"
        action={{ label: 'Registrar vacuna', to: '/record' }}
      />,
    );

    expect(screen.getByText('Aftosa vencida hace 6 días')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrar vacuna' })).toHaveAttribute(
      'href',
      '/record',
    );
    // No interrumpe al lector de pantalla: no es una región de alerta.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con una acción de botón, llama al manejador', async () => {
    const onClick = vi.fn();
    render(
      <AlertBanner
        tone="aviso"
        title="En retiro por medicamento hasta 28/09"
        action={{ label: 'Ver tratamiento', onClick }}
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Ver tratamiento' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState', () => {
  it('explica qué va aquí e invita a llenarlo', async () => {
    await renderWithRouter(
      <EmptyState
        icon={Scale}
        title="Todavía no hay pesajes"
        description="Registra el primero para ver la curva de crecimiento."
        action={{ label: 'Registrar pesaje', to: '/record' }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Todavía no hay pesajes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrar pesaje' })).toBeInTheDocument();
  });
});

describe('QuestionRow', () => {
  it('la fila completa es un enlace con la pregunta, la cifra y el resumen', async () => {
    await renderWithRouter(
      <QuestionRow
        question="¿Qué falta vacunar?"
        summary="9 vencidas · 15 esta quincena"
        value="24"
        tone="alerta"
        to="/alerts"
      />,
    );

    const link = screen.getByRole('link', { name: /¿Qué falta vacunar\?.*24/ });
    expect(link).toHaveAttribute('href', '/alerts');
    expect(link).toHaveTextContent('9 vencidas · 15 esta quincena');
    expect(screen.getByText('24')).toHaveClass('text-alerta');
  });
});
