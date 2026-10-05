import type { AnimalRef } from '@hato/shared';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { AnimalPicker } from '../../features/animals/form/AnimalPicker';
import { useRequiredSession } from '../../lib/auth/context';

export const Route = createFileRoute('/_app/record')({
  component: RecordPage,
});

const ANIMAL_ACTIONS = [
  { to: '/animals/$id/vaccination', label: 'Vacuna' },
  { to: '/animals/$id/weight', label: 'Peso' },
  { to: '/animals/$id/treatment', label: 'Tratamiento' },
] as const;

const FEMALE_ACTIONS = [
  { to: '/animals/$id/calving', label: 'Parto' },
  { to: '/animals/$id/service', label: 'Servicio' },
  { to: '/animals/$id/diagnosis', label: 'Palpación' },
] as const;

const LINK =
  'inline-flex min-h-touch items-center justify-center rounded-control border-2 border-potrero px-4 font-bold text-potrero hover:bg-potrero-claro';

/**
 * Registrar (06 §4): primero el animal (código, nombre o chip) y luego qué se registra: vacuna,
 * peso o tratamiento (M6), y en las hembras parto, servicio o palpación (M5; las pantallas de
 * reproducción explican si el animal no es hembra). Aparte, lo que se registra para muchos animales
 * a la vez: la vacunación por lote y la sesión de la báscula. El ADMIN registra además un gasto
 * (M7), del animal elegido o para repartir.
 */
function RecordPage() {
  const navigate = useNavigate();
  const [animal, setAnimal] = useState<AnimalRef | null>(null);
  const [missing, setMissing] = useState(false);
  const isAdmin = useRequiredSession().role === 'ADMIN';

  const go = (
    to: (typeof ANIMAL_ACTIONS)[number]['to'] | (typeof FEMALE_ACTIONS)[number]['to'],
  ) => {
    if (animal === null) {
      setMissing(true);
      return;
    }
    void navigate({ to, params: { id: animal.id } });
  };

  return (
    <>
      <PageHeader title="Registrar" />
      <div className="flex max-w-xl flex-col gap-5">
        <AnimalPicker
          label="Animal"
          hint="Escribe el código, el nombre o lee el chip."
          value={animal}
          onChange={(value) => {
            setAnimal(value);
            setMissing(false);
          }}
          error={missing ? 'Elige el animal.' : undefined}
        />
        <div role="group" aria-label="Qué registrar" className="grid gap-3 sm:grid-cols-3">
          {ANIMAL_ACTIONS.map((action) => (
            <Button
              key={action.to}
              block
              onClick={() => {
                go(action.to);
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="Reproducción (hembras)" className="grid gap-3 sm:grid-cols-3">
          {FEMALE_ACTIONS.map((action) => (
            <Button
              key={action.to}
              variant="secondary"
              block
              onClick={() => {
                go(action.to);
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
        <section className="flex flex-col gap-3 border-t border-cerca pt-5">
          <h2 className="text-md font-bold">Para muchos animales</h2>
          <div className="flex flex-wrap gap-2">
            <Link to="/vaccinations/bulk" className={LINK}>
              Vacunación por lote
            </Link>
            <Link to="/weights/import" className={LINK}>
              Importar pesaje de la báscula
            </Link>
          </div>
        </section>
        {isAdmin ? (
          <section className="flex flex-col gap-3 border-t border-cerca pt-5">
            <h2 className="text-md font-bold">Finanzas</h2>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/finance/expenses/new"
                search={animal === null ? {} : { animalId: animal.id }}
                className={LINK}
              >
                Gasto
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
