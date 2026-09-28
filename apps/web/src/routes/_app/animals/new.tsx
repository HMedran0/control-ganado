import { createFileRoute } from '@tanstack/react-router';

import { PageHeader } from '../../../components/layout/PageHeader';
import { AnimalForm } from '../../../features/animals/form/AnimalForm';

type NewAnimalSearch = { rfid?: string };

/** Registrar animal (ANI-01). Con `?rfid=`, el chip leído que no estaba registrado. */
export const Route = createFileRoute('/_app/animals/new')({
  validateSearch: (search: Record<string, unknown>): NewAnimalSearch => {
    const rfid = typeof search.rfid === 'number' ? String(search.rfid) : search.rfid;
    return typeof rfid === 'string' && /^\d{15}$/.test(rfid) ? { rfid } : {};
  },
  component: NewAnimalRoute,
});

function NewAnimalRoute() {
  const { rfid } = Route.useSearch();
  return (
    <>
      <PageHeader title="Registrar animal" />
      <AnimalForm {...(rfid === undefined ? {} : { initialRfid: rfid })} />
    </>
  );
}
