import { createFileRoute } from '@tanstack/react-router';

import { VaccinationPendingReportPage } from '../../../features/reports/HealthReports';

/** Pendientes de vacunación (RPT-02). */
export const Route = createFileRoute('/_app/reports/vaccination-pending')({
  component: VaccinationPendingReportPage,
});
