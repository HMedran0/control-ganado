import type { ReactNode } from 'react';

export type DataColumn<Row> = {
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
  /** Números a la derecha. */
  readonly numeric?: boolean;
};

/**
 * Tabla de un reporte: encabezados con `scope`, desplazamiento horizontal en el celular (06 §9) y
 * una fila de totales opcional.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  totals,
}: {
  caption: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  totals?: readonly ReactNode[];
}) {
  const align = (column: DataColumn<Row>) => (column.numeric === true ? 'text-right' : 'text-left');
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <caption className="mb-2 text-left font-bold">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-cerca">
            {columns.map((column) => (
              <th key={column.header} scope="col" className={`p-2 font-bold ${align(column)}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-b border-cerca">
              {columns.map((column) => (
                <td key={column.header} className={`p-2 ${align(column)}`}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals === undefined ? null : (
          <tfoot>
            <tr className="border-t-2 border-cerca font-bold">
              {totals.map((value, index) => (
                <td
                  key={columns[index]?.header ?? index}
                  className={`p-2 ${columns[index] === undefined ? 'text-left' : align(columns[index])}`}
                >
                  {value}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
