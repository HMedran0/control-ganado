import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataColumn, type SortState } from './DataTable';

type Animal = { id: string; code: string; name: string; breed: string; weight: string };

const ROWS: Animal[] = [
  { id: 'a', code: 'P-19', name: '—', breed: 'Gyr', weight: '418 kg' },
  { id: 'b', code: 'P-12', name: 'Canela', breed: 'Brahman', weight: '452 kg' },
];

const COLUMNS: DataColumn<Animal>[] = [
  { key: 'code', header: 'Código', cell: (row) => row.code, sortable: true, mobile: 'leading' },
  { key: 'name', header: 'Nombre', cell: (row) => row.name, mobile: 'primary' },
  { key: 'breed', header: 'Raza', cell: (row) => row.breed, mobile: 'secondary' },
  {
    key: 'weight',
    header: 'Último peso',
    cell: (row) => row.weight,
    sortable: true,
    align: 'end',
    mobile: 'secondary',
  },
];

function Tabla({ onSortChange = vi.fn() }: { onSortChange?: (s: SortState) => void }) {
  const [sort, setSort] = useState<SortState>({ key: 'code', direction: 'asc' });
  return (
    <DataTable
      caption="Animales preñados"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={(next) => {
        setSort(next);
        onSortChange(next);
      }}
    />
  );
}

describe('DataTable', () => {
  it('en escritorio es una tabla con título, encabezados de columna y aria-sort', () => {
    render(<Tabla />);

    const table = screen.getByRole('table', { name: 'Animales preñados' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('columnheader', { name: /Código/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(within(table).getByRole('columnheader', { name: 'Raza' })).not.toHaveAttribute(
      'aria-sort',
    );
  });

  it('ordenar por una columna avisa la columna y alterna la dirección', async () => {
    const onSortChange = vi.fn();
    render(<Tabla onSortChange={onSortChange} />);
    const user = userEvent.setup();
    const table = screen.getByRole('table');

    await user.click(within(table).getByRole('button', { name: /Código/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'code', direction: 'desc' });
    expect(within(table).getByRole('columnheader', { name: /Código/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await user.click(within(table).getByRole('button', { name: /Último peso/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'weight', direction: 'asc' });
  });

  it('en móvil es una lista: primero lo principal y debajo lo secundario', () => {
    render(<Tabla />);

    const list = screen.getByRole('list', { name: 'Animales preñados' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent('P-12');
    expect(items[1]).toHaveTextContent('Canela');
    expect(items[1]).toHaveTextContent('Brahman');
    expect(items[1]).toHaveTextContent('452 kg');
  });

  it('sin filas muestra el vacío que se le pase', () => {
    render(
      <DataTable
        caption="Animales"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<p>Todavía no hay animales.</p>}
      />,
    );

    expect(screen.getByText('Todavía no hay animales.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('DataTable con selección', () => {
  function Seleccionable() {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const toggle = (id: string) => {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };
    return (
      <>
        <DataTable
          caption="Animales"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          selection={{
            isSelected: (row) => selected.has(row.id),
            onToggle: (row) => {
              toggle(row.id);
            },
            rowLabel: (row) => `Seleccionar ${row.code}`,
            allSelected: selected.size === ROWS.length,
            onToggleAll: () => {
              setSelected(
                selected.size === ROWS.length ? new Set() : new Set(ROWS.map((row) => row.id)),
              );
            },
          }}
        />
        <p>Seleccionados: {selected.size}</p>
      </>
    );
  }

  it('cada fila tiene su casilla con nombre propio y «Seleccionar todos» marca las cargadas', async () => {
    const user = userEvent.setup();
    render(<Seleccionable />);

    const table = screen.getByRole('table', { name: 'Animales' });
    await user.click(within(table).getByRole('checkbox', { name: 'Seleccionar P-12' }));
    expect(screen.getByText('Seleccionados: 1')).toBeInTheDocument();

    await user.click(within(table).getByRole('checkbox', { name: 'Seleccionar todos' }));
    expect(screen.getByText('Seleccionados: 2')).toBeInTheDocument();
    expect(within(table).getByRole('checkbox', { name: 'Seleccionar P-19' })).toBeChecked();
  });
});
