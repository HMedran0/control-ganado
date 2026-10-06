import { createFileRoute } from '@tanstack/react-router';

import { ReportsIndex } from '../../../features/reports/ReportsIndex';

/** Reportes (RPT-02, RPT-03): la lista en el orden del sistema productivo. */
export const Route = createFileRoute('/_app/reports/')({
  component: ReportsIndex,
});
