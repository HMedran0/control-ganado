import type { AnimalDetail, Warning } from '@hato/shared';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormError } from '../../components/ui/FormError';
import { isApiError } from '../../lib/api/errors';
import { useAnimal } from '../animals/api';
import type { DetailTab } from '../animals/detail/tabs';
import '../animals/nav-state';

/**
 * Carga el animal de una pantalla de registro (vacuna, tratamiento, peso; M6). Solo los animales
 * activos admiten eventos (RN-09): para los demás se explica por qué, sin mostrar un formulario
 * que la API rechazaría.
 */
export function AnimalEventPage({
  id,
  title,
  children,
}: {
  id: string;
  title: (name: string) => string;
  children: (animal: AnimalDetail) => ReactNode;
}) {
  const animal = useAnimal(id);
  const navigate = useNavigate();
  if (animal.isPending) return <p className="text-texto-2">Cargando…</p>;
  if (animal.isError) {
    if (isApiError(animal.error) && animal.error.code === 'NOT_FOUND') {
      return (
        <EmptyState
          icon={SearchX}
          title="No encontramos este animal"
          description="Puede que el enlace esté mal o que el animal sea de otra finca."
          action={{ label: 'Ver los animales', to: '/animals' }}
        />
      );
    }
    return (
      <FormError
        message={isApiError(animal.error) ? animal.error.detail : 'No pudimos cargar el animal.'}
      />
    );
  }
  const data = animal.data;
  const name = data.name === null ? data.code : `${data.code} · ${data.name}`;
  return (
    <>
      <PageHeader title={title(name)} />
      {data.status === 'ACTIVE' ? (
        children(data)
      ) : (
        <EmptyState
          icon={CircleAlert}
          title="El animal ya no está en la finca; revierte la salida o restáuralo para registrarle eventos."
          description="Vuelve a la ficha del animal."
          action={{
            label: 'Abrir la ficha',
            onClick: () => {
              void navigate({ to: '/animals/$id', params: { id: data.id } });
            },
          }}
        />
      )}
    </>
  );
}

/** Vuelve a la ficha del animal, en la pestaña dada, con el mensaje y las advertencias. */
export function useBackToAnimal() {
  const navigate = useNavigate();
  return (animalId: string, tab: DetailTab, message: string, warnings: readonly Warning[] = []) =>
    navigate({
      to: '/animals/$id',
      params: { id: animalId },
      search: { tab },
      state: { animalSaved: message, animalWarnings: warnings },
    });
}
