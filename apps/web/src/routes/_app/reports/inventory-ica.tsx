import { createFileRoute } from '@tanstack/react-router';

import { IcaReportPage } from '../../../features/reports/StockReports';

/** Inventario por grupos de edad en formato ICA (RPT-02, 08 §2.2). */
export const Route = createFileRoute('/_app/reports/inventory-ica')({
  component: IcaReportPage,
});
