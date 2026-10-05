import { createFileRoute } from '@tanstack/react-router';

import { BulkVaccinationPage } from '../../../features/health/BulkVaccinationPage';

/** Vacunación por lote (SAN-03). `?vaccineId=` llega desde un ciclo oficial (SAN-06 CA3). */
export const Route = createFileRoute('/_app/vaccinations/bulk')({
  validateSearch: (search: Record<string, unknown>): { vaccineId?: string } =>
    typeof search.vaccineId === 'string' ? { vaccineId: search.vaccineId } : {},
  component: function BulkVaccinationRoute() {
    const { vaccineId } = Route.useSearch();
    return <BulkVaccinationPage vaccineId={vaccineId} />;
  },
});
