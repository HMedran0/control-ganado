import { createFileRoute } from '@tanstack/react-router';

import { AlertsPage, type AlertsSearch } from '../../features/alerts/AlertsPage';

/** Alertas (M6). Los filtros de tipo y lote van en la URL (06 §4). */
export const Route = createFileRoute('/_app/alerts')({
  validateSearch: (search: Record<string, unknown>): AlertsSearch => ({
    ...(typeof search.types === 'string' && search.types !== '' ? { types: search.types } : {}),
    ...(typeof search.lotId === 'string' && search.lotId !== '' ? { lotId: search.lotId } : {}),
  }),
  component: function AlertsRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <AlertsPage
        search={search}
        onSearch={(next) => {
          void navigate({ search: next, replace: true, resetScroll: false });
        }}
      />
    );
  },
});
