import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { PageHeader } from '../../../components/layout/PageHeader';
import { RequireRole } from '../../../components/layout/RequireRole';
import { LabelSheetPage } from '../../../features/animals/labels-sheet/LabelSheetPage';
import type { LabelFormat, Paper } from '../../../features/animals/labels-sheet/layout';

type LabelsSearch = {
  /** Selección: ids separados por coma. */
  ids?: string;
  /** Filtros del listado, tal como van a la API. */
  query?: string;
  paper?: Paper;
  format?: LabelFormat;
};

function validateLabelsSearch(search: Record<string, unknown>): LabelsSearch {
  return {
    ...(typeof search.ids === 'string' ? { ids: search.ids } : {}),
    ...(typeof search.query === 'string' ? { query: search.query } : {}),
    ...(search.paper === 'a4' || search.paper === 'letter' ? { paper: search.paper } : {}),
    ...(search.format === 'card' || search.format === 'label' ? { format: search.format } : {}),
  };
}

export const Route = createFileRoute('/_app/animals/labels')({
  validateSearch: validateLabelsSearch,
  component: LabelsRoute,
});

/** Hoja de etiquetas con QR (IDN-03 CA2, solo ADMIN). */
function LabelsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <RequireRole roles={['ADMIN']} title="Etiquetas">
      <div className="print:hidden">
        <PageHeader title="Etiquetas con QR">
          Para tarjetas de manejo o fichas de potrero. El QR abre la ficha del animal después de
          iniciar sesión.
        </PageHeader>
      </div>
      <LabelSheetPage
        source={{
          ...(search.ids === undefined ? {} : { ids: search.ids }),
          ...(search.query === undefined ? {} : { query: search.query }),
        }}
        paper={search.paper ?? 'letter'}
        format={search.format ?? 'label'}
        onChange={(next) => {
          void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });
        }}
      />
    </RequireRole>
  );
}
