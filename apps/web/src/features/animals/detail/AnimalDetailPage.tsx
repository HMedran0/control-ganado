import { formatAge, type AnimalDetail } from '@hato/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import { Pencil, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AlertBanner } from '../../../components/ui/AlertBanner';
import { Chapeta } from '../../../components/ui/Chapeta';
import { EmptyState } from '../../../components/ui/EmptyState';
import { FormError } from '../../../components/ui/FormError';
import { Tabs, type TabItem } from '../../../components/ui/Tabs';
import { Tag } from '../../../components/ui/Tag';
import { isApiError } from '../../../lib/api/errors';
import { useRequiredSession } from '../../../lib/auth/context';
import { useToday } from '../../../lib/clock';
import { useAnimal } from '../api';
import {
  CATEGORY_LABEL,
  DERIVED_TAG_TONE,
  derivedTagText,
  exitLabelFor,
  identifierText,
  SEX_LABEL,
} from '../labels';
import '../nav-state';
import { animalBanners } from './banners';
import { CostsTab, GenealogyTab, HistoryTab, ReproductionTab, SummaryTab } from './sections';

export const DETAIL_TABS = [
  'resumen',
  'reproduccion',
  'genealogia',
  'costos',
  'historial',
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/**
 * Ficha del animal (ANI-07, 06 §5.3): encabezado con la chapeta, identificadores, clasificación,
 * edad y avisos; pestañas Resumen, Reproducción (hembras), Genealogía, Costos (ADMIN) e Historial.
 * En escritorio el encabezado queda fijo a la izquierda y las pestañas a la derecha (06 §9).
 */
export function AnimalDetailPage({
  id,
  tab,
  previousIdentifier,
  onTabChange,
}: {
  id: string;
  tab: DetailTab | undefined;
  /** Valor del identificador retirado por el que se llegó (búsqueda, IDN-02 CA2). */
  previousIdentifier: string | undefined;
  onTabChange: (tab: DetailTab) => void;
}) {
  const animal = useAnimal(id);

  if (animal.isPending) return <p className="text-texto-2">Cargando ficha…</p>;
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
        message={isApiError(animal.error) ? animal.error.detail : 'No pudimos cargar la ficha.'}
      />
    );
  }
  return (
    <Detail
      animal={animal.data}
      tab={tab}
      previousIdentifier={previousIdentifier}
      onTabChange={onTabChange}
    />
  );
}

function Detail({
  animal,
  tab,
  previousIdentifier,
  onTabChange,
}: {
  animal: AnimalDetail;
  tab: DetailTab | undefined;
  previousIdentifier: string | undefined;
  onTabChange: (tab: DetailTab) => void;
}) {
  const session = useRequiredSession();
  const isAdmin = session.role === 'ADMIN';
  const today = useToday();
  const navigationState = useRouterState({ select: (state) => state.location.state });
  const [saved, setSaved] = useState<string | null>(navigationState.animalSaved ?? null);
  const warnings = navigationState.animalWarnings ?? [];
  const title = animal.name ?? animal.code;

  useEffect(() => {
    document.title = `${title} · Hato`;
  }, [title]);

  const items: TabItem<DetailTab>[] = [
    {
      value: 'resumen',
      label: 'Resumen',
      content: <SummaryTab animal={animal} isAdmin={isAdmin} onSaved={setSaved} />,
    },
    ...(animal.sex === 'FEMALE'
      ? [
          {
            value: 'reproduccion' as const,
            label: 'Reproducción',
            content: <ReproductionTab animal={animal} today={today} />,
          },
        ]
      : []),
    { value: 'genealogia', label: 'Genealogía', content: <GenealogyTab animal={animal} /> },
    ...(isAdmin
      ? [{ value: 'costos' as const, label: 'Costos', content: <CostsTab animal={animal} /> }]
      : []),
    { value: 'historial', label: 'Historial', content: <HistoryTab animal={animal} /> },
  ];
  // Una pestaña que este animal o este rol no tiene (Costos para un operario) abre Resumen.
  const current = items.some((item) => item.value === tab) ? (tab ?? 'resumen') : 'resumen';
  const active = animal.identifiers.filter((identifier) => identifier.retiredAt === null);
  const exitLabel = exitLabelFor(animal.status);
  const banners = animalBanners(animal, today);

  return (
    <div className="lg:grid lg:grid-cols-[20rem_1fr] lg:items-start lg:gap-8">
      <header className="mb-5 flex flex-col gap-4 lg:sticky lg:top-24">
        <div className="flex items-start gap-4">
          <Chapeta
            code={animal.code}
            size="m"
            {...(exitLabel === undefined ? {} : { exitLabel })}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-xl leading-tight font-bold break-words">{title}</h1>
            <p className="text-texto-2">
              {SEX_LABEL[animal.sex]} · {animal.breed.name} ·{' '}
              {formatAge({
                birthDate: animal.birthDate,
                today,
                estimated: animal.birthDateEstimated,
              })}
            </p>
            {active.length === 0 ? null : (
              <p className="text-texto-2">
                {active
                  .map((identifier) => identifierText(identifier.type, identifier.value))
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Tag tone="neutro">{CATEGORY_LABEL[animal.category]}</Tag>
          {animal.derivedTags.map((derived) => (
            <Tag key={derived} tone={DERIVED_TAG_TONE[derived]}>
              {derivedTagText(derived, animal.calvingCount)}
            </Tag>
          ))}
          {animal.manualTags.map((manual) => (
            <Tag key={manual.id} tone="potrero">
              {manual.label}
            </Tag>
          ))}
          {animal.forSale ? <Tag tone="potrero">Disponible para venta</Tag> : null}
          {animal.lot === null ? null : <Tag tone="neutro">Lote {animal.lot.name}</Tag>}
        </div>
        <Link
          to="/animals/$id/edit"
          params={{ id: animal.id }}
          className="inline-flex min-h-touch items-center gap-2 self-start rounded-control border-2 border-potrero px-4 font-bold text-potrero hover:bg-potrero-claro"
        >
          <Pencil aria-hidden="true" className="size-5" />
          {animal.status === 'ACTIVE' ? 'Editar datos' : 'Editar observaciones'}
        </Link>
      </header>

      <div className="flex min-w-0 flex-col gap-4">
        <p
          role="status"
          className={
            saved === null
              ? 'sr-only'
              : 'rounded-control bg-potrero-claro p-3 font-bold text-potrero'
          }
        >
          {saved}
        </p>
        {previousIdentifier === undefined ? null : (
          <AlertBanner
            tone="info"
            title="Identificador anterior"
            description={`Lo encontraste por ${previousIdentifier}, que ya no está activo en este animal.`}
          />
        )}
        {warnings.map((warning) => (
          <AlertBanner key={warning.code} tone="aviso" title={warning.message} />
        ))}
        {banners.map((banner) => (
          <AlertBanner
            key={banner.key}
            tone={banner.tone}
            title={banner.title}
            {...(banner.description === undefined ? {} : { description: banner.description })}
          />
        ))}
        <Tabs
          label="Secciones de la ficha"
          value={current}
          onValueChange={onTabChange}
          items={items}
        />
      </div>
    </div>
  );
}
