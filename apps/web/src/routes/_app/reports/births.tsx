import { createFileRoute } from '@tanstack/react-router';

import { PageHeader } from '../../../components/layout/PageHeader';
import { BirthsReportPage } from '../../../features/reproduction/BirthsReportPage';

/** Reporte de nacimientos (NAC-01). */
export const Route = createFileRoute('/_app/reports/births')({
  component: function BirthsReportRoute() {
    return (
      <>
        <PageHeader title="Nacimientos" />
        <BirthsReportPage />
      </>
    );
  },
});
