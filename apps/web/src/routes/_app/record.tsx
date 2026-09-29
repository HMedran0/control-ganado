import type { AnimalRef } from '@hato/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { AnimalPicker } from '../../features/animals/form/AnimalPicker';

export const Route = createFileRoute('/_app/record')({
  component: RecordPage,
});

const ACTIONS = [
  { to: '/animals/$id/calving', label: 'Parto' },
  { to: '/animals/$id/service', label: 'Servicio' },
  { to: '/animals/$id/diagnosis', label: 'Palpación' },
] as const;

/**
 * Registrar (06 §4): se elige la hembra por código, nombre o chip y luego qué se registra. En M5,
 * parto, servicio y palpación (el aborto está en la ficha); vacunas, pesajes y tratamientos llegan
 * con M6.
 */
function RecordPage() {
  const navigate = useNavigate();
  const [female, setFemale] = useState<AnimalRef | null>(null);
  const [missing, setMissing] = useState(false);

  return (
    <>
      <PageHeader title="Registrar" />
      <div className="flex max-w-xl flex-col gap-5">
        <AnimalPicker
          label="Hembra"
          hint="Escribe el código, el nombre o lee el chip."
          sex="FEMALE"
          value={female}
          onChange={(value) => {
            setFemale(value);
            setMissing(false);
          }}
          error={missing ? 'Elige la hembra.' : undefined}
        />
        <div role="group" aria-label="Qué registrar" className="grid gap-3 sm:grid-cols-3">
          {ACTIONS.map((action) => (
            <Button
              key={action.to}
              block
              onClick={() => {
                if (female === null) {
                  setMissing(true);
                  return;
                }
                void navigate({ to: action.to, params: { id: female.id } });
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
        <p className="text-texto-2">
          Vacunas, pesajes y tratamientos se registran aquí desde el próximo hito.
        </p>
      </div>
    </>
  );
}
