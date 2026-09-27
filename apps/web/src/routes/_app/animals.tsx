import { createFileRoute } from '@tanstack/react-router';
import { Tags } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Placeholder } from '../../components/layout/Placeholder';

export const Route = createFileRoute('/_app/animals')({
  component: AnimalsPage,
});

function AnimalsPage() {
  return (
    <>
      <PageHeader title="Animales" />
      <Placeholder icon={Tags}>
        Aquí vas a buscar cualquier animal por su chapeta, chip o nombre, y a ver su ficha completa.
      </Placeholder>
    </>
  );
}
