import { createFileRoute } from '@tanstack/react-router';

import { CycleProgressReportPage } from '../../../features/reports/HealthReports';

/** Avance de un ciclo de vacunación (RPT-02). */
export const Route = createFileRoute('/_app/reports/cycle-progress')({
  component: CycleProgressReportPage,
});
