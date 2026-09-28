import { createFileRoute, Link } from '@tanstack/react-router';
import { Archive, ChevronRight } from 'lucide-react';

import { RequireRole } from '../../../components/layout/RequireRole';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { FormError } from '../../../components/ui/FormError';
import { useAnimalList } from '../../../features/animals/api';
import { CATEGORY_LABEL, SEX_LABEL } from '../../../features/animals/labels';
import { SettingsHeader } from '../../../features/settings/SettingsHeader';
import { isApiError } from '../../../lib/api/errors';

export const Route = createFileRoute('/_app/settings/archived')({
  component: ArchivedPage,
});

/**
 * Configuración → Archivados (ANI-03 CA2): los animales archivados no aparecen en ningún otro
 * listado. Desde aquí se abre la ficha, que muestra el motivo y el botón «Restaurar animal».
 */
function ArchivedPage() {
  const list = useAnimalList('status=archived&sort=code');
  return (
    <RequireRole roles={['ADMIN']} title="Archivados">
      <SettingsHeader title="Archivados">
        Animales que se sacaron del hato por error o por estar duplicados. Abre la ficha para ver el
        motivo y restaurarlo.
      </SettingsHeader>
      {list.isPending ? (
        <p role="status" className="text-texto-2">
          Cargando…
        </p>
      ) : list.isError ? (
        <FormError message={isApiError(list.error) ? list.error.detail : 'No se pudo cargar.'} />
      ) : list.data.pages[0]?.total === 0 ? (
        <EmptyState
          icon={Archive}
          title="No hay animales archivados"
          description="Cuando archives un registro duplicado o hecho por error, aparece aquí."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ul aria-label="Animales archivados" className="flex flex-col gap-2">
            {list.data.pages
              .flatMap((page) => page.items)
              .map((animal) => (
                <li key={animal.id}>
                  <Link
                    to="/animals/$id"
                    params={{ id: animal.id }}
                    className="flex min-h-touch-primary items-center gap-4 rounded-panel border border-cerca bg-superficie p-4 hover:bg-potrero-claro"
                  >
                    <span className="flex flex-1 flex-col">
                      <span className="font-bold">
                        {animal.name === null ? animal.code : `${animal.code} · ${animal.name}`}
                      </span>
                      <span className="text-aux text-texto-2">
                        {SEX_LABEL[animal.sex]} · {CATEGORY_LABEL[animal.category]} ·{' '}
                        {animal.breed.name}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-5 text-texto-2" />
                  </Link>
                </li>
              ))}
          </ul>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              className="self-start"
              disabled={list.isFetchingNextPage}
              onClick={() => {
                void list.fetchNextPage();
              }}
            >
              {list.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
            </Button>
          ) : null}
        </div>
      )}
    </RequireRole>
  );
}
