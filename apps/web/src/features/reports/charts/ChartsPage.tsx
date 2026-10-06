import { CATEGORY_LABEL, formatDate, type ChartsReport } from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

import { PageHeader } from '../../../components/layout/PageHeader';
import { DataTable } from '../DataTable';
import { ReportStatus } from '../ReportFrame';
import { useReport } from '../api';
import { BirthsChart, CategoryChart, InventoryChart, monthLabel } from './ReportCharts';

/**
 * Gráficas (RPT-03, M8b): evolución del inventario en los últimos 12 meses, nacimientos por mes
 * y sexo, y distribución por categoría. Esta página es su propio chunk: las gráficas solo se
 * descargan al abrirla. Cada gráfica tiene debajo «Ver los datos», su tabla accesible.
 */
export function ChartsPage() {
  const report = useReport<ChartsReport>('/reports/charts');
  const data = report.data;
  return (
    <>
      <Link
        to="/reports"
        className="mb-2 inline-flex min-h-touch items-center gap-1 font-bold text-potrero underline underline-offset-4"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Reportes
      </Link>
      <PageHeader title="Gráficas">Cómo ha cambiado el hato en el último año.</PageHeader>
      <ReportStatus isPending={report.isPending} error={report.error} />
      {data === undefined ? null : (
        <div className="flex max-w-3xl flex-col gap-8">
          <section className="flex flex-col gap-3" aria-labelledby="grafica-inventario">
            <h2 id="grafica-inventario" className="text-md font-bold">
              Animales en la finca al cierre de cada mes
            </h2>
            <InventoryChart data={data.inventoryByMonth} />
            <details>
              <summary className="min-h-touch cursor-pointer font-bold text-potrero">
                Ver los datos
              </summary>
              <DataTable
                caption="Animales al cierre de cada mes"
                columns={[
                  { header: 'Mes', cell: (row) => monthLabel(row.month) },
                  { header: 'Al', cell: (row) => formatDate(row.on) },
                  { header: 'Hembras', cell: (row) => row.females, numeric: true },
                  { header: 'Machos', cell: (row) => row.males, numeric: true },
                  { header: 'Total', cell: (row) => row.total, numeric: true },
                ]}
                rows={data.inventoryByMonth}
                rowKey={(row) => row.month}
              />
            </details>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="grafica-nacimientos">
            <h2 id="grafica-nacimientos" className="text-md font-bold">
              Nacimientos por mes
            </h2>
            <BirthsChart data={data.birthsByMonth} />
            <details>
              <summary className="min-h-touch cursor-pointer font-bold text-potrero">
                Ver los datos
              </summary>
              <DataTable
                caption="Nacimientos por mes y sexo"
                columns={[
                  { header: 'Mes', cell: (row) => monthLabel(row.month) },
                  { header: 'Hembras', cell: (row) => row.females, numeric: true },
                  { header: 'Machos', cell: (row) => row.males, numeric: true },
                  { header: 'Total', cell: (row) => row.females + row.males, numeric: true },
                ]}
                rows={data.birthsByMonth}
                rowKey={(row) => row.month}
              />
            </details>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="grafica-categorias">
            <h2 id="grafica-categorias" className="text-md font-bold">
              Animales activos por categoría
            </h2>
            <CategoryChart data={data.byCategory} />
            <details>
              <summary className="min-h-touch cursor-pointer font-bold text-potrero">
                Ver los datos
              </summary>
              <DataTable
                caption="Animales activos por categoría"
                columns={[
                  { header: 'Categoría', cell: (row) => CATEGORY_LABEL[row.category] },
                  { header: 'Animales', cell: (row) => row.count, numeric: true },
                ]}
                rows={data.byCategory}
                rowKey={(row) => row.category}
              />
            </details>
          </section>
        </div>
      )}
    </>
  );
}
