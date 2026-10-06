import { createFileRoute } from '@tanstack/react-router';

import { VaccinationsReportPage } from '../../../features/reports/HealthReports';

/** Vacunados por período y vacuna (RPT-02). */
export const Route = createFileRoute('/_app/reports/vaccinations')({
  component: VaccinationsReportPage,
});
