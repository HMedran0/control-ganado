import { ArrowDown, ArrowUp, ArrowUpDown, Check } from 'lucide-react';
import type { ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc';
export type SortState = { readonly key: string; readonly direction: SortDirection };

export type DataColumn<T> = {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  readonly sortable?: boolean;
  readonly align?: 'start' | 'end';
  /**
   * Cómo aparece en la lista de móvil: `leading` a la izquierda (la chapeta), `primary` en la
   * primera línea, `secondary` en la segunda, `hidden` no se muestra.
   */
  readonly mobile?: 'leading' | 'primary' | 'secondary' | 'hidden';
  /** `false`: solo en la lista de móvil (por ejemplo, una línea que en la tabla tiene columnas). */
  readonly desktop?: boolean;
};

/**
 * Selección múltiple (operaciones en lote, CLS-02 CA2). La casilla de cada fila lleva un
 * nombre propio para lectores de pantalla («Seleccionar 26-045»).
 */
export type DataTableSelection<T> = {
  readonly isSelected: (row: T) => boolean;
  readonly onToggle: (row: T) => void;
  /** Nombre de la fila en la casilla: «Seleccionar 26-045». */
  readonly rowLabel: (row: T) => string;
  readonly allSelected: boolean;
  readonly onToggleAll: () => void;
};

export type DataTableProps<T> = {
  /** Describe la tabla para lectores de pantalla («Animales preñados»). */
  readonly caption: string;
  readonly columns: readonly DataColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly sort?: SortState;
  readonly onSortChange?: (sort: SortState) => void;
  /** Qué mostrar si no hay filas (normalmente un EmptyState). */
  readonly empty?: ReactNode;
  readonly selection?: DataTableSelection<T>;
};

const ARIA_SORT: Record<SortDirection, 'ascending' | 'descending'> = {
  asc: 'ascending',
  desc: 'descending',
};

/**
 * Listado (06 §6 y §9): tabla con columnas ordenables en escritorio (≥ 1024 px) y lista de
 * filas en móvil, donde una tabla ancha obligaría a desplazarse de lado.
 *
 * Las dos vistas se generan y el CSS muestra una: la oculta queda con `display: none`, así que
 * el lector de pantalla solo ve la que está en pantalla. Ordenar lo decide quien la usa (el
 * orden viene de la API con paginación); la tabla solo avisa qué columna se pidió.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  empty,
  selection,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;

  const tableColumns = columns.filter((column) => column.desktop !== false);
  const leading = columns.filter((column) => column.mobile === 'leading');
  const primary = columns.filter((column) => (column.mobile ?? 'primary') === 'primary');
  const secondary = columns.filter((column) => column.mobile === 'secondary');

  return (
    <>
      <div className="hidden overflow-x-auto rounded-panel border border-cerca bg-superficie lg:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-cerca">
              {selection === undefined ? null : (
                <th scope="col" className="w-14 px-2">
                  <SelectBox
                    label="Seleccionar todos"
                    checked={selection.allSelected}
                    onChange={selection.onToggleAll}
                  />
                </th>
              )}
              {tableColumns.map((column) => {
                const sorted = sort?.key === column.key ? sort.direction : undefined;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={sorted === undefined ? undefined : ARIA_SORT[sorted]}
                    className={`px-3 py-3 text-aux font-bold text-texto-2 ${column.align === 'end' ? 'text-right' : ''}`}
                  >
                    {column.sortable === true && onSortChange !== undefined ? (
                      <button
                        type="button"
                        onClick={() => {
                          onSortChange({
                            key: column.key,
                            direction: sorted === 'asc' ? 'desc' : 'asc',
                          });
                        }}
                        className="-mx-2 inline-flex min-h-touch items-center gap-1 rounded-control px-2 hover:bg-potrero-claro"
                      >
                        {column.header}
                        <SortIcon direction={sorted} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-cerca last:border-b-0">
                {selection === undefined ? null : (
                  <td className="px-2 align-middle">
                    <SelectBox
                      label={selection.rowLabel(row)}
                      checked={selection.isSelected(row)}
                      onChange={() => {
                        selection.onToggle(row);
                      }}
                    />
                  </td>
                )}
                {tableColumns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-3 align-middle ${column.align === 'end' ? 'text-right tabular-nums' : ''}`}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul
        aria-label={caption}
        className="divide-y divide-cerca rounded-panel border border-cerca bg-superficie lg:hidden"
      >
        {rows.map((row) => (
          <li key={rowKey(row)} className="flex items-center gap-3 p-3">
            {selection === undefined ? null : (
              <SelectBox
                label={selection.rowLabel(row)}
                checked={selection.isSelected(row)}
                onChange={() => {
                  selection.onToggle(row);
                }}
              />
            )}
            {leading.map((column) => (
              <div key={column.key} className="shrink-0">
                {column.cell(row)}
              </div>
            ))}
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2 font-bold">
                {primary.map((column) => (
                  <span key={column.key}>{column.cell(row)}</span>
                ))}
              </div>
              {secondary.length === 0 ? null : (
                // Sin separadores: al partirse la línea, un «·» quedaba suelto al comienzo.
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-texto-2">
                  {secondary.map((column) => (
                    <span key={column.key} className="inline-flex items-center">
                      {column.cell(row)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Casilla de selección con objetivo táctil de 48 px; el cuadro se dibuja como en `Checkbox`. */
function SelectBox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="relative inline-flex size-12 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className="peer size-6 cursor-pointer appearance-none rounded-[6px] border-2 border-texto-2 bg-superficie checked:border-potrero checked:bg-potrero"
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute hidden size-5 text-white peer-checked:block"
      />
    </label>
  );
}

function SortIcon({ direction }: { direction: SortDirection | undefined }) {
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
  return <Icon aria-hidden="true" className="size-4" />;
}
