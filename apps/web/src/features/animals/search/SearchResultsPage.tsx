import type { AnimalRef, SearchMatch, SearchResultItem } from '@hato/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Nfc, SearchX } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/Button';
import { Chapeta } from '../../../components/ui/Chapeta';
import { Dialog } from '../../../components/ui/Dialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { FormError } from '../../../components/ui/FormError';
import { isApiError } from '../../../lib/api/errors';
import { useRequiredSession } from '../../../lib/auth/context';
import { useIdentifierMutations, useSearch } from '../api';
import { IdentifierSaveError } from '../detail/Identifiers';
import { AnimalPicker } from '../form/AnimalPicker';
import { exitLabelFor, IDENTIFIER_TYPE_LABEL } from '../labels';
import '../nav-state';
import { AnimalSearchBar } from './AnimalSearchBar';
import { offersRfidAssociation } from './outcome';

/** Por qué coincidió: «Chapeta 087», «Chip anterior 982…», «Código», «Nombre». */
export function matchText(match: SearchMatch): string {
  if (match.kind === 'CODE') return `Código ${match.value}`;
  if (match.kind === 'NAME') return `Nombre ${match.value}`;
  const type = IDENTIFIER_TYPE_LABEL[match.identifierType];
  return match.previous ? `${type} anterior ${match.value}` : `${type} ${match.value}`;
}

function ResultRow({ item }: { item: SearchResultItem }) {
  const exitLabel = exitLabelFor(item.status);
  return (
    <li className="flex items-center gap-3 p-3">
      <Chapeta code={item.code} size="s" {...(exitLabel === undefined ? {} : { exitLabel })} />
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          to="/animals/$id"
          params={{ id: item.id }}
          className="-my-3 inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
        >
          {item.name === null ? item.code : `${item.code} · ${item.name}`}
        </Link>
        <p className="text-texto-2">{item.matches.map(matchText).join(' · ')}</p>
      </div>
    </li>
  );
}

/**
 * Resultados de la búsqueda (ANI-05) cuando no hay una coincidencia exacta única:
 * - varias exactas de animales distintos, cada una con el porqué;
 * - parecidas (búsqueda difusa);
 * - un chip desconocido: «Asociar a un animal» o «Registrar animal nuevo» (ANI-05 CA3).
 */
export function SearchResultsPage({ q }: { q: string }) {
  const search = useSearch(q);
  const [associating, setAssociating] = useState(false);

  const header = (
    <>
      <PageHeader title="Buscar animal" documentTitle={q === '' ? 'Buscar' : `Buscar «${q}»`} />
      <div className="mb-5 lg:hidden">
        <AnimalSearchBar />
      </div>
    </>
  );

  if (q.trim() === '') {
    return (
      <>
        {header}
        <p className="text-texto-2">Escribe un código, un nombre o lee un chip.</p>
      </>
    );
  }
  if (search.isPending) {
    return (
      <>
        {header}
        <p className="text-texto-2">Buscando «{q}»…</p>
      </>
    );
  }
  if (search.isError) {
    return (
      <>
        {header}
        <FormError
          message={
            isApiError(search.error) ? search.error.detail : 'No pudimos buscar. Intenta de nuevo.'
          }
        />
      </>
    );
  }

  const result = search.data;
  const exact = result.items.filter((item) => item.exact);
  const similar = result.items.filter((item) => !item.exact);
  const unknownChip = offersRfidAssociation(q, result);

  return (
    <>
      {header}
      <p aria-live="polite" className="mb-4 font-bold">
        {result.items.length === 0
          ? `Ningún animal coincide con «${q}».`
          : exact.length > 1
            ? `Varios animales coinciden exactamente con «${q}». Elige cuál.`
            : `Resultados para «${q}».`}
      </p>

      {unknownChip ? (
        <div className="mb-6 flex max-w-prose flex-col items-start gap-3 rounded-panel border-2 border-chapeta bg-superficie p-5">
          <span className="flex size-12 items-center justify-center rounded-full bg-aviso-claro text-aviso">
            <Nfc aria-hidden="true" className="size-6" />
          </span>
          <h2 className="text-md font-bold">El chip {q} no está registrado</h2>
          <p className="text-texto-2">
            Puedes asociarlo a un animal que ya está en la finca o registrar un animal nuevo con
            este chip.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setAssociating(true);
              }}
            >
              Asociar a un animal
            </Button>
            <Link
              to="/animals/new"
              search={{ rfid: q.replace(/\s/g, '') }}
              className="inline-flex min-h-touch items-center rounded-control border-2 border-potrero px-4 font-bold text-potrero hover:bg-potrero-claro"
            >
              Registrar animal nuevo
            </Link>
          </div>
        </div>
      ) : null}

      {exact.length === 0 ? null : (
        <section aria-labelledby="exactas" className="mb-6">
          <h2 id="exactas" className="mb-2 font-bold">
            Coincidencias exactas
          </h2>
          <ul className="divide-y divide-cerca rounded-panel border border-cerca bg-superficie">
            {exact.map((item) => (
              <ResultRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}
      {similar.length === 0 ? null : (
        <section aria-labelledby="parecidos">
          <h2 id="parecidos" className="mb-2 font-bold">
            Parecidos
          </h2>
          <ul className="divide-y divide-cerca rounded-panel border border-cerca bg-superficie">
            {similar.map((item) => (
              <ResultRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}
      {result.items.length === 0 && !unknownChip ? (
        <EmptyState
          icon={SearchX}
          title="No encontramos ese animal"
          description="Revisa el número o busca por otro dato: código, nombre, chapeta, chip o DIN."
          action={{ label: 'Ver todos los animales', to: '/animals' }}
        />
      ) : null}

      {associating ? (
        <AssociateChipDialog
          chip={q.replace(/\s/g, '')}
          onClose={() => {
            setAssociating(false);
          }}
        />
      ) : null}
    </>
  );
}

/** «Asociar a un animal»: elegir el animal y agregarle el chip leído (IDN-01). */
function AssociateChipDialog({ chip, onClose }: { chip: string; onClose: () => void }) {
  const session = useRequiredSession();
  const navigate = useNavigate();
  const [animal, setAnimal] = useState<AnimalRef | null>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Asociar el chip a un animal"
      description={`Chip ${chip}. Busca el animal por su código, nombre o chapeta.`}
    >
      <AssociateForm
        chip={chip}
        animal={animal}
        onAnimalChange={setAnimal}
        isAdmin={session.role === 'ADMIN'}
        onDone={(animalId) => {
          void navigate({
            to: '/animals/$id',
            params: { id: animalId },
            state: { animalSaved: `Chip ${chip} asociado.` },
          });
        }}
      />
    </Dialog>
  );
}

function AssociateForm({
  chip,
  animal,
  onAnimalChange,
  isAdmin,
  onDone,
}: {
  chip: string;
  animal: AnimalRef | null;
  onAnimalChange: (animal: AnimalRef | null) => void;
  isAdmin: boolean;
  onDone: (animalId: string) => void;
}) {
  const { add } = useIdentifierMutations(animal?.id ?? '');
  const [missing, setMissing] = useState(false);

  const save = async (confirmReuse: boolean): Promise<void> => {
    if (animal === null) {
      setMissing(true);
      return;
    }
    try {
      await add.mutateAsync({
        type: 'RFID',
        value: chip,
        ...(confirmReuse ? { confirmReuse } : {}),
      });
      onDone(animal.id);
    } catch {
      // El error se muestra abajo.
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <AnimalPicker
        label="Animal"
        value={animal}
        onChange={(next) => {
          setMissing(false);
          onAnimalChange(next);
        }}
        error={missing ? 'Elige el animal.' : undefined}
      />
      <IdentifierSaveError
        error={add.error}
        isAdmin={isAdmin}
        onConfirmReuse={() => {
          void save(true);
        }}
      />
      <Button type="submit" block disabled={add.isPending}>
        {add.isPending ? 'Guardando…' : 'Asociar chip'}
      </Button>
    </form>
  );
}
