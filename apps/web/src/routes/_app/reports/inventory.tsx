import { createFileRoute } from '@tanstack/react-router';

import { InventoryReportPage } from '../../../features/reports/StockReports';

/** Reporte de inventario (RPT-02). */
export const Route = createFileRoute('/_app/reports/inventory')({
  component: InventoryReportPage,
});
