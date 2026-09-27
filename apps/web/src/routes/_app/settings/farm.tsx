import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { RequireRole } from '../../../components/layout/RequireRole';
import { FormError } from '../../../components/ui/FormError';
import { useFarm } from '../../../features/settings/api';
import { FarmForm } from '../../../features/settings/forms/FarmForm';
import { SettingsHeader } from '../../../features/settings/SettingsHeader';
import { isApiError } from '../../../lib/api/errors';

export const Route = createFileRoute('/_app/settings/farm')({
  component: FarmSettingsPage,
});

function FarmSettingsPage() {
  const farm = useFarm();
  // Se remonta el formulario solo al recargar tras un conflicto; guardar no lo reinicia, para
  // que se vea «Parámetros guardados».
  const [reloads, setReloads] = useState(0);
  return (
    <RequireRole roles={['ADMIN']} title="Finca y parámetros">
      <SettingsHeader title="Finca y parámetros">
        Los cálculos del hato (categorías, alertas, fechas de parto) usan estos valores.
      </SettingsHeader>
      {farm.isPending ? (
        <p role="status" className="text-texto-2">
          Cargando…
        </p>
      ) : farm.isError ? (
        <FormError message={isApiError(farm.error) ? farm.error.detail : 'No se pudo cargar.'} />
      ) : (
        <FarmForm
          key={reloads}
          farm={farm.data}
          onReload={() => {
            void farm.refetch().then(() => {
              setReloads((count) => count + 1);
            });
          }}
        />
      )}
    </RequireRole>
  );
}
