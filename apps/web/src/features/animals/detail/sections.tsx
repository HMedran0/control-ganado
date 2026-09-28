import {
  formatCop,
  formatDate,
  formatWeight,
  type AnimalDetail,
  type AnimalRef,
  type GenealogyNode,
  type IsoDate,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { History } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { FormError } from '../../../components/ui/FormError';
import { Timeline } from '../../../components/ui/Timeline';
import { isApiError } from '../../../lib/api/errors';
import { useGenealogy, useTimeline } from '../api';
import { calvingText } from '../list/AnimalCells';
import { ORIGIN_LABEL, SEX_LABEL, STATUS_LABEL, WEIGHT_METHOD_LABEL } from '../labels';
import { EXIT_TYPE_LABEL, toTimelineItem } from './history';
import { IdentifiersSection } from './Identifiers';

/** Lista de datos «etiqueta: valor», que un lector de pantalla lee como pares. */
function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-bold text-texto-2">{label}</dt>
          <dd className="-mt-2 sm:mt-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AnimalLinkRef({ animal }: { animal: AnimalRef | GenealogyNode }) {
  return (
    <Link
      to="/animals/$id"
      params={{ id: animal.id }}
      className="-my-3 inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
    >
      {animal.name === null ? animal.code : `${animal.code} · ${animal.name}`}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-cerca pb-5 last:border-b-0">
      <h2 className="text-md font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function SummaryTab({
  animal,
  isAdmin,
  onSaved,
}: {
  animal: AnimalDetail;
  isAdmin: boolean;
  onSaved: (message: string) => void;
}) {
  const weight = animal.lastWeight;
  return (
    <div className="flex flex-col gap-5">
      <Section title="Datos">
        <Facts
          items={[
            ['Sexo', SEX_LABEL[animal.sex]],
            ['Raza', animal.breed.name],
            [
              'Nacimiento',
              `${animal.birthDateEstimated ? '≈ ' : ''}${formatDate(animal.birthDate)}`,
            ],
            [
              'Procedencia',
              animal.origin === 'PURCHASED'
                ? `Comprado · ingresó el ${formatDate(animal.entryDate)}${animal.originDetail === null ? '' : ` · ${animal.originDetail}`}`
                : ORIGIN_LABEL[animal.origin],
            ],
            ['Lote', animal.lot?.name ?? 'Sin lote'],
            ['Madre', animal.dam === null ? '—' : <AnimalLinkRef animal={animal.dam} />],
            [
              'Padre',
              animal.sire === null ? (
                (animal.sireExternalRef ?? '—')
              ) : (
                <AnimalLinkRef animal={animal.sire} />
              ),
            ],
            ...(animal.exit === null
              ? []
              : ([
                  [
                    'Salida',
                    `${EXIT_TYPE_LABEL[animal.exit.type]} · ${formatDate(animal.exit.date)}${animal.exit.reason === null ? '' : ` · ${animal.exit.reason}`}`,
                  ],
                ] as const)),
            ['Observaciones', animal.notes ?? '—'],
          ]}
        />
      </Section>
      <Section title="Último peso">
        {weight === null ? (
          <p className="text-texto-2">Todavía no tiene pesajes.</p>
        ) : (
          <p>
            <span className="text-md font-bold">{formatWeight(weight.weightKg)}</span> ·{' '}
            {formatDate(weight.weighedOn)} · con {WEIGHT_METHOD_LABEL[weight.method]}
          </p>
        )}
      </Section>
      <IdentifiersSection animal={animal} isAdmin={isAdmin} onSaved={onSaved} />
    </div>
  );
}

export function ReproductionTab({ animal, today }: { animal: AnimalDetail; today: IsoDate }) {
  const reproduction = animal.reproduction;
  if (reproduction === null) return null;
  const open = reproduction.openPregnancy;
  return (
    <div className="flex flex-col gap-5">
      <Section title="Preñez actual">
        {open === null ? (
          <p className="text-texto-2">No tiene una preñez abierta.</p>
        ) : (
          <Facts
            items={[
              ['Servicio', formatDate(open.serviceDate)],
              [
                'Diagnóstico',
                open.confirmedAt === null
                  ? 'Sin palpar todavía'
                  : `Preñez confirmada el ${formatDate(open.confirmedAt)}`,
              ],
              [
                'Parto estimado',
                <strong key="parto">{calvingText(open.expectedCalvingDate, today)}</strong>,
              ],
            ]}
          />
        )}
      </Section>
      <Section title="Partos">
        <Facts
          items={[
            ['Partos registrados', String(reproduction.calvingCount)],
            [
              'Último parto',
              reproduction.lastCalvingDate === null
                ? '—'
                : formatDate(reproduction.lastCalvingDate),
            ],
          ]}
        />
      </Section>
    </div>
  );
}

function NodeLine({ node }: { node: GenealogyNode }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <AnimalLinkRef animal={node} />
      <span className="text-texto-2">
        {SEX_LABEL[node.sex]} · {formatDate(node.birthDate)}
        {node.status === 'ACTIVE' ? '' : ` · ${STATUS_LABEL[node.status]}`}
      </span>
    </span>
  );
}

export function GenealogyTab({ animal }: { animal: AnimalDetail }) {
  const genealogy = useGenealogy(animal.id);
  if (genealogy.isPending) return <p className="text-texto-2">Cargando genealogía…</p>;
  if (genealogy.isError) {
    return (
      <FormError
        message={
          isApiError(genealogy.error) ? genealogy.error.detail : 'No pudimos cargar la genealogía.'
        }
      />
    );
  }
  const { dam, sire, sireExternalRef, offspring } = genealogy.data;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Madre">
        {dam === null ? (
          <p className="text-texto-2">Sin madre registrada.</p>
        ) : (
          <>
            <NodeLine node={dam} />
            <p className="text-texto-2">
              Abuela materna: {dam.dam === null ? '—' : dam.dam.code} · Abuelo materno:{' '}
              {dam.sire?.code ?? dam.sireExternalRef ?? '—'}
            </p>
          </>
        )}
      </Section>
      <Section title="Padre">
        {sire === null ? (
          <p className={sireExternalRef === null ? 'text-texto-2' : ''}>
            {sireExternalRef ?? 'Sin padre registrado.'}
          </p>
        ) : (
          <>
            <NodeLine node={sire} />
            <p className="text-texto-2">
              Abuela paterna: {sire.dam === null ? '—' : sire.dam.code} · Abuelo paterno:{' '}
              {sire.sire?.code ?? sire.sireExternalRef ?? '—'}
            </p>
          </>
        )}
      </Section>
      <Section title={offspring.length === 0 ? 'Crías' : `Crías (${offspring.length})`}>
        {offspring.length === 0 ? (
          <p className="text-texto-2">No tiene crías registradas.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {offspring.map((child) => (
              <li key={child.id} className="flex flex-col gap-1">
                <NodeLine node={child} />
                {child.offspring.length === 0 ? null : (
                  <p className="pl-4 text-texto-2">
                    Sus crías: {child.offspring.map((grandchild) => grandchild.code).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Costos (solo ADMIN, RN-20). La inversión completa llega con Finanzas (M7). */
export function CostsTab({ animal }: { animal: AnimalDetail }) {
  const price = animal.economics?.purchasePrice ?? null;
  return (
    <Section title="Compra">
      {price === null ? (
        <p className="text-texto-2">
          {animal.origin === 'PURCHASED'
            ? 'No tiene valor de compra registrado. Puedes agregarlo al editar el animal.'
            : 'Nació en la finca: no tiene valor de compra.'}
        </p>
      ) : (
        <Facts
          items={[
            ['Valor de compra', <strong key="valor">{formatCop(price)}</strong>],
            ['Fecha de ingreso', formatDate(animal.entryDate)],
          ]}
        />
      )}
    </Section>
  );
}

export function HistoryTab({ animal }: { animal: AnimalDetail }) {
  const timeline = useTimeline(animal.id);
  if (timeline.isPending) return <p className="text-texto-2">Cargando historial…</p>;
  if (timeline.isError) {
    return (
      <FormError
        message={
          isApiError(timeline.error) ? timeline.error.detail : 'No pudimos cargar el historial.'
        }
      />
    );
  }
  const items = timeline.data.pages.flatMap((page) => page.items).map(toTimelineItem);
  if (items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Todavía no hay eventos"
        description="Aquí van a aparecer los servicios, partos, vacunas, pesajes y cambios del animal."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Timeline items={items} label={`Historial de ${animal.name ?? animal.code}`} />
      {timeline.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          disabled={timeline.isFetchingNextPage}
          onClick={() => {
            void timeline.fetchNextPage();
          }}
        >
          {timeline.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
        </Button>
      ) : null}
    </div>
  );
}
