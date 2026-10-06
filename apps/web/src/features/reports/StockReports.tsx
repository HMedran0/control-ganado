import {
  CATEGORY_LABEL,
  ICA_AGE_GROUP_LABEL,
  REPORT,
  SEX,
  formatDate,
  type IcaInventoryReport,
  type InventoryReport,
  type Sex,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';

import { ReportFrame, ReportStatus } from './ReportFrame';
import { DataTable, type DataColumn } from './DataTable';
import { useReport } from './api';

type BySexRow = { readonly males: number; readonly females: number; readonly total: number };

function bySexColumns<Row extends BySexRow>(): DataColumn<Row>[] {
  return [
    { header: 'Machos', cell: (row) => row.males, numeric: true },
    { header: 'Hembras', cell: (row) => row.females, numeric: true },
    { header: 'Total', cell: (row) => row.total, numeric: true },
  ];
}

/** Inventario por sexo, categoría, raza y lote (RPT-02). Cada fila enlaza a su listado. */
export function InventoryReportPage() {
  const report = useReport<InventoryReport>('/reports/inventory');
  const data = report.data;
  const totals = (label: string) =>
    data === undefined ? undefined : [label, data.males, data.females, data.total];
  const listLink = (search: Record<string, string>, text: string) => (
    <Link
      to="/animals"
      search={search}
      className="font-bold text-potrero underline underline-offset-4"
    >
      {text}
    </Link>
  );
  return (
    <ReportFrame report={REPORT.INVENTORY} exportPath="/reports/inventory/export?format=xlsx">
      <ReportStatus isPending={report.isPending} error={report.error} />
      {data === undefined ? null : (
        <>
          <p className="text-texto-2">
            Corte: {formatDate(data.today)}. {data.total} animales activos: {data.males} machos y{' '}
            {data.females} hembras.
          </p>
          <DataTable
            caption="Por categoría"
            columns={[
              {
                header: 'Categoría',
                cell: (row) => listLink({ category: row.category }, CATEGORY_LABEL[row.category]),
              },
              ...bySexColumns<InventoryReport['byCategory'][number]>(),
            ]}
            rows={data.byCategory}
            rowKey={(row) => row.category}
            totals={totals('Total')}
          />
          <DataTable
            caption="Por raza"
            columns={[
              { header: 'Raza', cell: (row) => listLink({ breedId: row.breedId }, row.name) },
              ...bySexColumns<InventoryReport['byBreed'][number]>(),
            ]}
            rows={data.byBreed}
            rowKey={(row) => row.breedId}
            totals={totals('Total')}
          />
          <DataTable
            caption="Por lote"
            columns={[
              {
                header: 'Lote',
                cell: (row) =>
                  row.lotId === null ? 'Sin lote' : listLink({ lotId: row.lotId }, row.name ?? ''),
              },
              ...bySexColumns<InventoryReport['byLot'][number]>(),
            ]}
            rows={data.byLot}
            rowKey={(row) => row.lotId ?? 'sin-lote'}
            totals={totals('Total')}
          />
        </>
      )}
    </ReportFrame>
  );
}

const SEX_TITLE: Readonly<Record<Sex, string>> = { FEMALE: 'Hembras', MALE: 'Machos' };

/**
 * Inventario por grupos de edad en formato ICA (08 §2.2). Formato propuesto: los datos de la
 * finca y una tabla por sexo con sus grupos y el total [Validar con el ICA y la finca].
 */
export function IcaReportPage() {
  const report = useReport<IcaInventoryReport>('/reports/inventory-ica');
  const data = report.data;
  return (
    <ReportFrame
      report={REPORT.INVENTORY_ICA}
      exportPath="/reports/inventory-ica/export?format=xlsx"
    >
      <ReportStatus isPending={report.isPending} error={report.error} />
      {data === undefined ? null : (
        <>
          <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-texto-2">Finca</dt>
            <dd className="font-bold">{data.farm.name}</dd>
            <dt className="text-texto-2">Ubicación</dt>
            <dd>
              {[data.farm.municipality, data.farm.department].filter(Boolean).join(', ') || '—'}
            </dd>
            <dt className="text-texto-2">Código de predio ICA</dt>
            <dd>{data.farm.icaPremiseCode ?? 'Sin registrar'}</dd>
            <dt className="text-texto-2">Corte</dt>
            <dd>{formatDate(data.today)}</dd>
          </dl>
          <div className="grid gap-6 lg:grid-cols-2">
            {([SEX.FEMALE, SEX.MALE] as Sex[]).map((sex) => {
              const rows = data.groups.filter((row) => row.sex === sex);
              return (
                <DataTable
                  key={sex}
                  caption={SEX_TITLE[sex]}
                  columns={[
                    { header: 'Grupo de edad', cell: (row) => ICA_AGE_GROUP_LABEL[row.group] },
                    { header: 'Animales', cell: (row) => row.count, numeric: true },
                  ]}
                  rows={rows}
                  rowKey={(row) => row.group}
                  totals={['Total', sex === SEX.FEMALE ? data.totals.females : data.totals.males]}
                />
              );
            })}
          </div>
          <p className="font-bold">Total de animales: {data.totals.total}</p>
        </>
      )}
    </ReportFrame>
  );
}
