import { createFileRoute } from '@tanstack/react-router';
import { Tags } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';

export const Route = createFileRoute('/_app/animals')({
  component: AnimalsPage,
});

function AnimalsPage() {
  return (
    <>
      <PageHeader title="Animales" />
      <EmptyState
        icon={Tags}
        title="Todavía no hay animales para mostrar"
        description="Aquí vas a buscar cualquier animal por su chapeta, chip o nombre, y a ver su ficha completa."
      />
    </>
  );
}
