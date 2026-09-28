import { createFileRoute } from '@tanstack/react-router';

import { PageHeader } from '../../../../components/layout/PageHeader';
import { FormError } from '../../../../components/ui/FormError';
import { useAnimal } from '../../../../features/animals/api';
import { AnimalForm } from '../../../../features/animals/form/AnimalForm';
import { isApiError } from '../../../../lib/api/errors';

/** Editar animal (ANI-02). */
export const Route = createFileRoute('/_app/animals/$id/edit')({
  component: EditAnimalRoute,
});

function EditAnimalRoute() {
  const { id } = Route.useParams();
  const animal = useAnimal(id);
  if (animal.isPending) return <p className="text-texto-2">Cargando animal…</p>;
  if (animal.isError) {
    return (
      <FormError
        message={isApiError(animal.error) ? animal.error.detail : 'No pudimos cargar el animal.'}
      />
    );
  }
  const title = `Editar ${animal.data.name ?? animal.data.code}`;
  return (
    <>
      <PageHeader title={title} />
      <AnimalForm
        // Al recargar tras un conflicto de versión, el formulario arranca con los datos nuevos.
        key={`${animal.data.id}:${animal.data.version}`}
        animal={animal.data}
        onReload={() => {
          void animal.refetch();
        }}
      />
    </>
  );
}
