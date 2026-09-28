import { createFileRoute } from '@tanstack/react-router';

import { RequireRole } from '../../../components/layout/RequireRole';
import { ImportPage } from '../../../features/imports/ImportPage';
import { SettingsHeader } from '../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/import')({
  component: ImportRoute,
});

/** Configuración → Importar inventario (ANI-09, solo ADMIN). */
function ImportRoute() {
  return (
    <RequireRole roles={['ADMIN']} title="Importar inventario">
      <SettingsHeader title="Importar inventario">
        Carga el hato desde una hoja de Excel o un CSV, revisando antes cada fila.
      </SettingsHeader>
      <ImportPage />
    </RequireRole>
  );
}
