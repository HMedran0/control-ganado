import {
  CATEGORY_LABEL,
  REPORT,
  VACCINE_STATUS_LABEL,
  formatDate,
  type CycleProgressView,
  type VaccinationPendingReport,
  type VaccinationsReport,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Syringe } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/SelectField';
import { useCatalog } from '../settings/api';
import { DataTable } from './DataTable';
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

/** Vacunados por período y vacuna (RPT-02). */
export function VaccinationsReportPage() {
  const period = usePeriod();
  const [vaccineId, setVaccineId] = useState('');
  const vaccines = useCatalog('vaccines', true);
  const query = queryOf({ from: period.from, to: period.to, vaccineId });
  const report = useReport<VaccinationsReport>(`/reports/vaccinations${query}`, period.valid);
  const data = report.data;
  return (
    <ReportFrame
      report={REPORT.VACCINATIONS}
      exportPath={period.valid ? `/reports/vaccinations/export${query}` : null}
      filters={
        <>
          <PeriodFilter period={period} />
          <SelectField
            label="Vacuna"
            value={vaccineId}
            onChange={(event) => {
              setVaccineId(event.target.value);
            }}
          >
            <option value="">Todas</option>
            {(vaccines.data?.items ?? []).map((vaccine) => (
              <option key={vaccine.id} value={vaccine.id}>
                {vaccine.name}
              </option>
            ))}
          </SelectField>
        </>
      }
    >
      <ReportStatus isPending={period.valid && report.isPending} error={report.error} />
      {data === undefined ? null : data.items.length === 0 ? (
        <EmptyState
          icon={Syringe}
          title="No hay vacunas en este período"
          description="Las vacunas que se registren aparecen aquí."
        />
      ) : (
        <>
          <DataTable
            caption="Por vacuna"
            columns={[
              { header: 'Vacuna', cell: (row) => row.name },
              { header: 'Aplicaciones', cell: (row) => row.count, numeric: true },
            ]}
            rows={data.byVaccine}
            rowKey={(row) => row.vaccineId}
            totals={['Total', data.items.length]}
          />
          <DataTable
            caption="Vacunados"
            columns={[
              { header: 'Fecha', cell: (row) => formatDate(row.appliedOn) },
              { header: 'Animal', cell: (row) => animalLink(row.animal) },
              { header: 'Vacuna', cell: (row) => row.vaccine.name },
              { header: 'Ciclo', cell: (row) => row.cycle ?? '—' },
              { header: 'Responsable', cell: (row) => row.responsible ?? '—' },
            ]}
            rows={data.items}
            rowKey={(row) => row.id}
          />
        </>
      )}
    </ReportFrame>
  );
}

/** Pendientes de vacunación: lo mismo que Alertas, una fila por animal y vacuna (RPT-02). */
export function VaccinationPendingReportPage() {
  const report = useReport<VaccinationPendingReport>('/reports/vaccination-pending');
  const data = report.data;
  return (
    <ReportFrame
      report={REPORT.VACCINATION_PENDING}
      exportPath="/reports/vaccination-pending/export?format=xlsx"
    >
      <ReportStatus isPending={report.isPending} error={report.error} />
      {data === undefined ? null : data.items.length === 0 ? (
        <EmptyState
          icon={Syringe}
          title="No hay vacunas pendientes"
          description="Todos los animales activos están al día."
        />
      ) : (
        <>
          <p className="text-texto-2">
            Corte: {formatDate(data.today)}. {data.animals}{' '}
            {data.animals === 1 ? 'animal tiene' : 'animales tienen'} alguna vacuna por aplicar.
          </p>
          <DataTable
            caption="Vacunas por aplicar"
            columns={[
              { header: 'Animal', cell: (row) => animalLink(row.animal) },
              { header: 'Categoría', cell: (row) => CATEGORY_LABEL[row.category] },
              { header: 'Lote', cell: (row) => row.lot ?? '—' },
              { header: 'Vacuna', cell: (row) => row.vaccine.name },
              { header: 'Estado', cell: (row) => VACCINE_STATUS_LABEL[row.status] },
              {
                header: 'Fecha',
                cell: (row) => (row.dueOn === null ? '—' : formatDate(row.dueOn)),
              },
            ]}
            rows={data.items}
            rowKey={(row) => `${row.animal.id}:${row.vaccine.id}`}
          />
        </>
      )}
    </ReportFrame>
  );
}

/** Avance de un ciclo de vacunación (SAN-06 CA2), con su Excel (RPT-02). */
export function CycleProgressReportPage() {
  const cycles = useCatalog('cycles', true);
  const [chosen, setChosen] = useState('');
  const items = cycles.data?.items ?? [];
  // Por defecto, el ciclo más reciente.
  const cycleId =
    chosen !== ''
      ? chosen
      : ([...items].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0]?.id ?? '');
  const report = useReport<CycleProgressView>(
    `/vaccination-cycles/${cycleId}/progress`,
    cycleId !== '',
  );
  const data = report.data;
  return (
    <ReportFrame
      report={REPORT.CYCLE_PROGRESS}
      exportPath={cycleId === '' ? null : `/reports/cycle-progress/export${queryOf({ cycleId })}`}
      filters={
        <SelectField
          label="Ciclo"
          value={cycleId}
          onChange={(event) => {
            setChosen(event.target.value);
          }}
        >
          {items.length === 0 ? <option value="">No hay ciclos</option> : null}
          {items.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.name}
            </option>
          ))}
        </SelectField>
      }
    >
      <ReportStatus isPending={cycleId !== '' && report.isPending} error={report.error} />
      {data === undefined ? null : (
        <DataTable
          caption={`${data.cycle.name}: del ${formatDate(data.cycle.startsOn)} al ${formatDate(data.cycle.endsOn)}`}
          columns={[
            { header: 'Vacuna', cell: (row) => row.name },
            { header: 'Debían vacunarse', cell: (row) => row.eligible, numeric: true },
            { header: 'Vacunados', cell: (row) => row.vaccinated, numeric: true },
            { header: 'Faltan', cell: (row) => row.pending, numeric: true },
          ]}
          rows={data.vaccines}
          rowKey={(row) => row.vaccineId}
        />
      )}
    </ReportFrame>
  );
}
