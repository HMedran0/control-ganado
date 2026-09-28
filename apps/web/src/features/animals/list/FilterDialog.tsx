import {
  ANIMAL_ALERT,
  MANAGEMENT_CATEGORY,
  type LotView,
  type BreedView,
  type TagView,
} from '@hato/shared';
import { useState, type ReactNode } from 'react';

import { Button } from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Dialog } from '../../../components/ui/Dialog';
import { NumberField } from '../../../components/ui/NumberField';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { DEFAULT_FILTERS, DERIVED_TAG_KEYS, type AnimalListFilters } from '../filters';
import { ALERT_LABEL, CATEGORY_FILTER_LABEL, DERIVED_TAG_FILTER_LABEL } from '../labels';

function toggle<T extends string>(items: readonly T[], item: T): T[] {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1 border-t border-cerca pt-4">
      <legend className="mb-1 font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Panel «+ Filtro» del listado (06 §5.2). Se arma el filtro con calma y se aplica de una vez:
 * cada toque no dispara una consulta ni cambia la URL.
 */
export function FilterDialog({
  open,
  onOpenChange,
  filters,
  onApply,
  lots,
  breeds,
  tags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: AnimalListFilters;
  onApply: (filters: AnimalListFilters) => void;
  lots: readonly LotView[];
  breeds: readonly BreedView[];
  tags: readonly TagView[];
}) {
  const [draft, setDraft] = useState(filters);
  const set = (patch: Partial<AnimalListFilters>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(filters);
        onOpenChange(next);
      }}
      title="Filtrar animales"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
        }}
      >
        <SegmentedChoice
          label="Mostrar"
          options={[
            { value: 'active', label: 'En la finca' },
            { value: 'exited', label: 'Vendidos o retirados' },
          ]}
          value={draft.status}
          onChange={(status) => {
            set({ status });
          }}
        />
        <SegmentedChoice
          label="Sexo"
          options={[
            { value: 'ALL', label: 'Todos' },
            { value: 'FEMALE', label: 'Hembras' },
            { value: 'MALE', label: 'Machos' },
          ]}
          value={draft.sex ?? 'ALL'}
          onChange={(sex) => {
            set({ sex: sex === 'ALL' ? null : sex });
          }}
        />
        <Section title="Categoría">
          {Object.values(MANAGEMENT_CATEGORY).map((category) => (
            <Checkbox
              key={category}
              label={CATEGORY_FILTER_LABEL[category]}
              checked={draft.category.includes(category)}
              onChange={() => {
                set({ category: toggle(draft.category, category) });
              }}
            />
          ))}
        </Section>
        <Section title="Etiquetas">
          {DERIVED_TAG_KEYS.map((tag) => (
            <Checkbox
              key={tag}
              label={DERIVED_TAG_FILTER_LABEL[tag]}
              checked={draft.tags.includes(tag)}
              onChange={() => {
                set({ tags: toggle(draft.tags, tag) });
              }}
            />
          ))}
          {tags.map((tag) => (
            <Checkbox
              key={tag.id}
              label={tag.label}
              checked={draft.tags.includes(tag.key)}
              onChange={() => {
                set({ tags: toggle(draft.tags, tag.key) });
              }}
            />
          ))}
          <Checkbox
            label="Disponibles para venta"
            checked={draft.forSale === true}
            onChange={() => {
              set({ forSale: draft.forSale === true ? null : true });
            }}
          />
        </Section>
        <Section title="Alertas">
          {Object.values(ANIMAL_ALERT).map((alert) => (
            <Checkbox
              key={alert}
              label={ALERT_LABEL[alert]}
              checked={draft.alerts.includes(alert)}
              onChange={() => {
                set({ alerts: toggle(draft.alerts, alert) });
              }}
            />
          ))}
        </Section>
        {lots.length === 0 ? null : (
          <Section title="Lote">
            {lots.map((lot) => (
              <Checkbox
                key={lot.id}
                label={lot.name}
                checked={draft.lotId.includes(lot.id)}
                onChange={() => {
                  set({ lotId: toggle(draft.lotId, lot.id) });
                }}
              />
            ))}
          </Section>
        )}
        {breeds.length === 0 ? null : (
          <Section title="Raza">
            {breeds.map((breed) => (
              <Checkbox
                key={breed.id}
                label={breed.name}
                checked={draft.breedId.includes(breed.id)}
                onChange={() => {
                  set({ breedId: toggle(draft.breedId, breed.id) });
                }}
              />
            ))}
          </Section>
        )}
        <Section title="Edad en meses">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Desde"
              value={draft.ageMin === null ? null : String(draft.ageMin)}
              onChange={(value) => {
                set({ ageMin: value === null ? null : Number(value) });
              }}
            />
            <NumberField
              label="Hasta"
              value={draft.ageMax === null ? null : String(draft.ageMax)}
              onChange={(value) => {
                set({ ageMax: value === null ? null : Number(value) });
              }}
            />
          </div>
        </Section>
        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t border-cerca bg-superficie p-4 lg:flex-row-reverse">
          <Button type="submit" block className="lg:w-auto">
            Aplicar filtros
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft({ ...DEFAULT_FILTERS, sort: draft.sort });
            }}
          >
            Quitar todos
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
