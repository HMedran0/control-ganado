import type { AnimalListItem, AnimalSort } from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Download, Plus, Printer, SlidersHorizontal, Tags, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/Button';
import { DataTable, type DataColumn, type SortState } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/EmptyState';
import { FormError } from '../../../components/ui/FormError';
import { SelectField } from '../../../components/ui/SelectField';
import { isApiError } from '../../../lib/api/errors';
import { useRequiredSession } from '../../../lib/auth/context';
import { useToday } from '../../../lib/clock';
import { useCatalog } from '../../settings/api';
import { useAnimalList, useExportAnimals } from '../api';
import { apiQuery, filterChips, hasFilters, type AnimalListFilters } from '../filters';
import { animalsCount } from '../labels';
import { AnimalSearchBar } from '../search/AnimalSearchBar';
import {
  AlertsText,
  AnimalChapeta,
  AnimalLink,
  AnimalSummaryLine,
  ageText,
  calvingText,
  ClassificationTags,
  lastWeightText,
} from './AnimalCells';
import { BulkActions } from './BulkActions';
import { FilterDialog } from './FilterDialog';

/** Columnas ordenables y su orden en la API. */
const SORT_OF: Record<string, readonly [AnimalSort, AnimalSort]> = {
  code: ['code', '-code'],
  age: ['age', '-age'],
  lastWeight: ['lastWeight', '-lastWeight'],
  // Solo del más próximo al más lejano (CU-03); sin preñez, al final.
  calving: ['calving', 'calving'],
};

function sortState(sort: AnimalSort): SortState {
  const key = sort.replace(/^-/, '');
  return { key, direction: sort.startsWith('-') ? 'desc' : 'asc' };
}

const SORT_OPTIONS: readonly { value: AnimalSort; label: string }[] = [
  { value: 'code', label: 'Código' },
  { value: 'age', label: 'Menor edad primero' },
  { value: '-age', label: 'Mayor edad primero' },
  { value: '-lastWeight', label: 'Mayor peso primero' },
  { value: 'lastWeight', label: 'Menor peso primero' },
  { value: 'calving', label: 'Parto más próximo primero' },
];

const CHIP =
  'inline-flex min-h-touch items-center gap-1 rounded-full border-2 border-potrero bg-potrero-claro px-4 font-bold text-potrero hover:bg-superficie';

/**
 * Listado de animales (ANI-06, 06 §5.2): filtros como chips reflejados en la URL, tabla con la
 * chapeta en escritorio y lista en móvil, orden por código, edad y último peso, «Cargar más» y
 * selección múltiple para las operaciones en lote.
 */
export function AnimalListPage({
  filters,
  onFiltersChange,
}: {
  filters: AnimalListFilters;
  onFiltersChange: (filters: AnimalListFilters) => void;
}) {
  const session = useRequiredSession();
  const isAdmin = session.role === 'ADMIN';
  const today = useToday();
  const query = apiQuery(filters);
  const list = useAnimalList(query);
  const exportList = useExportAnimals();
  const lots = useCatalog('lots', true);
  const breeds = useCatalog('breeds', true);
  const tags = useCatalog('tags', true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');

  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total;
  const names = useMemo(
    () => ({
      lots: new Map((lots.data?.items ?? []).map((lot) => [lot.id, lot.name])),
      breeds: new Map((breeds.data?.items ?? []).map((breed) => [breed.id, breed.name])),
      tags: new Map((tags.data?.items ?? []).map((tag) => [tag.key, tag.label])),
    }),
    [lots.data, breeds.data, tags.data],
  );
  const chips = filterChips(filters, names);
  const activeLots = (lots.data?.items ?? []).filter((lot) => lot.isActive);
  const activeTags = (tags.data?.items ?? []).filter((tag) => tag.isActive);

  const change = (next: AnimalListFilters) => {
    setSelected(new Set());
    onFiltersChange(next);
  };

  const columns: DataColumn<AnimalListItem>[] = [
    {
      key: 'code',
      header: 'Código',
      sortable: true,
      mobile: 'leading',
      cell: (animal) => <AnimalChapeta animal={animal} />,
    },
    {
      key: 'name',
      header: 'Nombre',
      mobile: 'primary',
      cell: (animal) => <AnimalLink animal={animal} />,
    },
    {
      key: 'summary',
      header: 'Animal',
      mobile: 'secondary',
      desktop: false,
      cell: (animal) => <AnimalSummaryLine animal={animal} today={today} />,
    },
    { key: 'breed', header: 'Raza', mobile: 'hidden', cell: (animal) => animal.breed.name },
    {
      key: 'age',
      header: 'Edad',
      sortable: true,
      mobile: 'hidden',
      cell: (animal) => <span className="whitespace-nowrap">{ageText(animal, today)}</span>,
    },
    {
      key: 'tags',
      header: 'Clasificación',
      mobile: 'hidden',
      cell: (animal) => <ClassificationTags animal={animal} compact />,
    },
    {
      key: 'tagsMobile',
      header: 'Clasificación',
      mobile: 'secondary',
      desktop: false,
      cell: (animal) => <ClassificationTags animal={animal} />,
    },
    {
      key: 'calving',
      header: 'Parto estimado',
      mobile: 'hidden',
      sortable: true,
      cell: (animal) =>
        animal.expectedCalvingDate === null ? (
          <span className="text-texto-2">—</span>
        ) : (
          // La fecha y los días pueden quedar en dos líneas: el espacio fuera de los `span` que no
          // se parten es el único punto de corte.
          <span>
            {calvingText(animal.expectedCalvingDate, today, true)
              .split(' · ')
              .map((part, index) =>
                index === 0 ? (
                  <span key={part} className="whitespace-nowrap">
                    {part}
                  </span>
                ) : (
                  <Fragment key={part}>
                    {' '}
                    <span className="whitespace-nowrap">· {part}</span>
                  </Fragment>
                ),
              )}
          </span>
        ),
    },
    {
      key: 'lastWeight',
      header: 'Último peso',
      sortable: true,
      align: 'end',
      mobile: 'hidden',
      cell: (animal) => <span className="whitespace-nowrap">{lastWeightText(animal)}</span>,
    },
    {
      key: 'alerts',
      header: 'Alertas',
      mobile: 'secondary',
      cell: (animal) => <AlertsText animal={animal} />,
    },
  ];

  return (
    <>
      <PageHeader title="Animales" />
      <div className="mb-4 lg:hidden">
        <AnimalSearchBar />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Filtros puestos"
          role="group"
        >
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={CHIP}
              aria-label={`Quitar filtro ${chip.label}`}
              onClick={() => {
                change(chip.without);
              }}
            >
              {chip.label}
              <X aria-hidden="true" className="size-4" />
            </button>
          ))}
          <Button
            variant="secondary"
            className="rounded-full"
            onClick={() => {
              setFilterOpen(true);
            }}
          >
            <SlidersHorizontal aria-hidden="true" className="size-5" />
            {chips.length === 0 ? 'Filtrar' : '+ Filtro'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={exportList.isPending}
            onClick={() => {
              exportList.mutate(query);
            }}
          >
            <Download aria-hidden="true" className="size-5" />
            {exportList.isPending ? 'Preparando…' : 'Excel'}
          </Button>
          {isAdmin ? (
            <Link
              to="/animals/labels"
              search={{ query }}
              className="inline-flex min-h-touch items-center gap-2 rounded-control border-2 border-potrero bg-superficie px-4 font-bold text-potrero hover:bg-potrero-claro"
            >
              <Printer aria-hidden="true" className="size-5" />
              Etiquetas
            </Link>
          ) : null}
          <Link
            to="/animals/new"
            className="inline-flex min-h-touch-primary items-center gap-2 rounded-control bg-potrero px-5 font-bold text-white hover:bg-monte"
          >
            <Plus aria-hidden="true" className="size-5" />
            Nuevo animal
          </Link>
        </div>
      </div>
      <FormError
        message={
          exportList.error === null
            ? null
            : isApiError(exportList.error)
              ? exportList.error.detail
              : 'No pudimos preparar el archivo.'
        }
      />

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p aria-live="polite" className="font-bold">
          {total === undefined ? '' : animalsCount(total)}
        </p>
        <div className="w-60 lg:hidden">
          <SelectField
            label="Ordenar por"
            value={filters.sort}
            onChange={(event) => {
              const sort = SORT_OPTIONS.find((option) => option.value === event.target.value);
              if (sort !== undefined) change({ ...filters, sort: sort.value });
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      {list.isError ? (
        <FormError
          message={isApiError(list.error) ? list.error.detail : 'No pudimos cargar los animales.'}
        />
      ) : list.isPending ? (
        <p className="text-texto-2">Cargando animales…</p>
      ) : (
        <>
          <DataTable
            caption="Animales"
            columns={columns}
            rows={rows}
            rowKey={(animal) => animal.id}
            sort={sortState(filters.sort)}
            onSortChange={(next) => {
              const pair = SORT_OF[next.key];
              if (pair !== undefined) {
                change({ ...filters, sort: next.direction === 'asc' ? pair[0] : pair[1] });
              }
            }}
            selection={{
              isSelected: (animal) => selected.has(animal.id),
              onToggle: (animal) => {
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(animal.id)) next.delete(animal.id);
                  else next.add(animal.id);
                  return next;
                });
              },
              rowLabel: (animal) => `Seleccionar ${animal.code}`,
              allSelected: rows.length > 0 && rows.every((animal) => selected.has(animal.id)),
              onToggleAll: () => {
                setSelected(
                  rows.every((animal) => selected.has(animal.id))
                    ? new Set()
                    : new Set(rows.map((animal) => animal.id)),
                );
              },
            }}
            empty={
              hasFilters(filters) ? (
                <EmptyState
                  icon={Tags}
                  title="Ningún animal cumple estos filtros"
                  description="Quita algún filtro para ver más animales."
                  action={{
                    label: 'Quitar los filtros',
                    onClick: () => {
                      change({ ...filters, ...emptyFilters() });
                    },
                  }}
                />
              ) : (
                <EmptyState
                  icon={Tags}
                  title="Todavía no hay animales"
                  description="Registra el primero para empezar a llevar el hato."
                  action={{ label: 'Registrar animal', to: '/animals/new' }}
                />
              )
            }
          />
          {list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                disabled={list.isFetchingNextPage}
                onClick={() => {
                  void list.fetchNextPage();
                }}
              >
                {list.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <div className="mt-4">
        <BulkActions
          selectedIds={[...selected]}
          isAdmin={isAdmin}
          tags={activeTags}
          lots={activeLots}
          onClear={() => {
            setSelected(new Set());
          }}
          onDone={(message) => {
            setAnnouncement(message);
            setSelected(new Set());
          }}
        />
      </div>
      <p
        role="status"
        className={
          announcement === ''
            ? 'sr-only'
            : 'mt-3 rounded-control bg-potrero-claro p-3 font-bold text-potrero'
        }
      >
        {announcement}
      </p>

      <FilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filters={filters}
        onApply={(next) => {
          setFilterOpen(false);
          change(next);
        }}
        lots={activeLots}
        breeds={(breeds.data?.items ?? []).filter((breed) => breed.isActive)}
        tags={activeTags}
      />
    </>
  );
}

/** Todo menos el orden. */
function emptyFilters(): Omit<AnimalListFilters, 'sort'> {
  return {
    sex: null,
    category: [],
    tags: [],
    lotId: [],
    breedId: [],
    alerts: [],
    ageMin: null,
    ageMax: null,
    forSale: null,
    bornFrom: null,
    bornTo: null,
    saleWeight: null,
    milkWithdrawal: null,
    status: 'active',
  };
}
