import { createFileRoute } from '@tanstack/react-router';

import { CalvingsUpcomingReportPage } from '../../../features/reports/HerdReports';

/** Partos próximos (RPT-02). */
export const Route = createFileRoute('/_app/reports/calvings-upcoming')({
  component: CalvingsUpcomingReportPage,
});
