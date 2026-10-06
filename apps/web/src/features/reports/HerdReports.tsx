import {
  EXIT_TYPE,
  EXIT_TYPE_LABEL,
  REPORT,
  SEX_LABEL,
  formatCop,
  formatDate,
  type CalvingsUpcomingReport,
  type ExitType,
  type ExitsReport,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Baby, LogOut } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/SelectField';
import { useRequiredSession } from '../../lib/auth/context';
import { DataTable, type DataColumn } from './DataTable';
import { PeriodFilter, usePeriod } from './PeriodFilter';
import { ReportFrame, ReportStatus } from './ReportFrame';
import { queryOf, useReport } from './api';

const animalLink = (animal: { id: string; code: string }) => (
  <Link
    to="/animals/$id"
    params={{ id: animal.id }}
    className="font-bold text-potrero underline underline-offset-4"
  >
    {animal.code}
  </Link>
);

/** «en 12 días», «hoy», «hace 3 días». */
function daysText(days: number): string {
  if (days === 0) return 'Hoy';
  if (days > 0) return days === 1 ? 'En 1 día' : `En ${days} días`;
  return days === -1 ? 'Hace 1 día' : `Hace ${-days} días`;
}

/** Partos próximos y vencidos, por fecha estimada (RPT-02, CU-03). */
export function CalvingsUpcomingReportPage() {
  const report = useReport<CalvingsUpcomingReport>('/reports/calvings-upcoming');
  const data = report.data;
  return (
    <ReportFrame
      report={REPORT.CALVINGS_UPCOMING}
      exportPath="/reports/calvings-upcoming/export?format=xlsx"
    >
      <ReportStatus isPending={report.isPending} error={report.error} />
      {data === undefined ? null : data.items.length === 0 ? (
        <EmptyState
          icon={Baby}
          title="No hay partos próximos"
          description={`Ninguna preñada pare en los próximos ${data.windowDays} días.`}
        />
      ) : (
        <>
          <p className="text-texto-2">
            Corte: {formatDate(data.today)}. Preñadas que paren en los próximos {data.windowDays}{' '}
            días o ya debían parir.
          </p>
          <DataTable
            caption="Partos próximos"
            columns={[
              { header: 'Hembra', cell: (row) => animalLink(row.dam) },
              { header: 'Lote', cell: (row) => row.lot ?? '—' },
              { header: 'Servicio', cell: (row) => formatDate(row.serviceDate) },
              { header: 'Padre', cell: (row) => row.sire ?? '—' },
              { header: 'Parto estimado', cell: (row) => formatDate(row.expectedCalvingDate) },
              {
                header: 'Cuándo',
                cell: (row) => (
                  <span className={row.daysToCalving < 0 ? 'font-bold text-alerta' : undefined}>
                    {daysText(row.daysToCalving)}
                  </span>
                ),
              },
            ]}
            rows={data.items}
            rowKey={(row) => row.pregnancyId}
          />
        </>
      )}
    </ReportFrame>
  );
}

type ExitRow = ExitsReport['items'][number];

/** Vendidos y retirados por período (RPT-02). Precio y comprador solo para el ADMIN (RN-20). */
export function ExitsReportPage() {
  const session = useRequiredSession();
  const period = usePeriod();
  const [type, setType] = useState<ExitType | ''>('');
  const query = queryOf({ from: period.from, to: period.to, type });
  const report = useReport<ExitsReport>(`/reports/exits${query}`, period.valid);
  const data = report.data;
  const money: DataColumn<ExitRow>[] =
    session.role === 'ADMIN'
      ? [
          {
            header: 'Precio de venta',
            cell: (row) =>
              row.salePrice === null || row.salePrice === undefined
                ? '—'
                : formatCop(row.salePrice),
            numeric: true,
          },
          { header: 'Comprador', cell: (row) => row.buyer ?? '—' },
        ]
      : [];
  return (
    <ReportFrame
      report={REPORT.EXITS}
      exportPath={period.valid ? `/reports/exits/export${query}` : null}
      filters={
        <>
          <PeriodFilter period={period} />
          <SelectField
            label="Tipo de salida"
            value={type}
            onChange={(event) => {
              setType(event.target.value as ExitType | '');
            }}
          >
            <option value="">Todas</option>
            {Object.values(EXIT_TYPE).map((value) => (
              <option key={value} value={value}>
                {EXIT_TYPE_LABEL[value]}
              </option>
            ))}
          </SelectField>
        </>
      }
    >
      <ReportStatus isPending={period.valid && report.isPending} error={report.error} />
      {data === undefined ? null : data.items.length === 0 ? (
        <EmptyState
          icon={LogOut}
          title="No hubo salidas en este período"
          description="Las ventas, muertes y demás salidas aparecen aquí."
        />
      ) : (
        <>
          <p className="text-texto-2">
            {data.byType.map((row) => `${EXIT_TYPE_LABEL[row.type]}: ${row.count}`).join(' · ')}
          </p>
          <DataTable
            caption="Salidas del período"
            columns={[
              { header: 'Fecha', cell: (row) => formatDate(row.exitDate) },
              { header: 'Animal', cell: (row) => animalLink(row.animal) },
              { header: 'Sexo', cell: (row) => SEX_LABEL[row.animal.sex] },
              { header: 'Salida', cell: (row) => EXIT_TYPE_LABEL[row.exitType] },
              { header: 'Motivo', cell: (row) => row.reason ?? '—' },
              ...money,
            ]}
            rows={data.items}
            rowKey={(row) => row.animal.id}
          />
        </>
      )}
    </ReportFrame>
  );
}
