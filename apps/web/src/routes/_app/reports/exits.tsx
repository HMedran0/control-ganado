import { createFileRoute } from '@tanstack/react-router';

import { ExitsReportPage } from '../../../features/reports/HerdReports';

/** Vendidos y retirados (RPT-02). */
export const Route = createFileRoute('/_app/reports/exits')({
  component: ExitsReportPage,
});
