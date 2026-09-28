import {
  daysBetween,
  formatAge,
  formatDate,
  formatWeight,
  type AnimalListItem,
  type IsoDate,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';

import { Chapeta } from '../../../components/ui/Chapeta';
import { Tag } from '../../../components/ui/Tag';
import {
  ALERT_LABEL,
  CATEGORY_LABEL,
  DERIVED_TAG_TONE,
  derivedTagText,
  exitLabelFor,
  SEX_LABEL,
} from '../labels';

/** Piezas de cada fila del listado (06 §5.2), compartidas por la tabla y la lista de móvil. */

export function AnimalChapeta({ animal }: { animal: AnimalListItem }) {
  const exitLabel = exitLabelFor(animal.status);
  return (
    <Chapeta code={animal.code} size="s" {...(exitLabel === undefined ? {} : { exitLabel })} />
  );
}

/** Enlace a la ficha: el nombre, o el código si no tiene nombre. */
export function AnimalLink({ animal }: { animal: AnimalListItem }) {
  return (
    <Link
      to="/animals/$id"
      params={{ id: animal.id }}
      className="-my-3 inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
    >
      {animal.name ?? animal.code}
      {animal.name === null ? null : <span className="sr-only"> ({animal.code})</span>}
    </Link>
  );
}

export function ageText(animal: AnimalListItem, today: IsoDate): string {
  return formatAge({ birthDate: animal.birthDate, today, estimated: animal.birthDateEstimated });
}

/** «Hembra · Brahman · 5 a 2 m». */
export function AnimalSummaryLine({ animal, today }: { animal: AnimalListItem; today: IsoDate }) {
  return (
    <span>
      {SEX_LABEL[animal.sex]} · {animal.breed.name} · {ageText(animal, today)}
    </span>
  );
}

/**
 * Categoría, etiquetas derivadas y manuales, siempre con texto (06 §8). En la tabla de
 * escritorio va sin la categoría y con «Parida · 4», como en el prototipo (06 §5.2): el ancho
 * no alcanza para todo.
 */
export function ClassificationTags({
  animal,
  compact = false,
}: {
  animal: AnimalListItem;
  compact?: boolean;
}) {
  const empty =
    compact && animal.derivedTags.length === 0 && animal.manualTags.length === 0 && !animal.forSale;
  if (empty) return <span className="text-texto-2">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {compact ? null : <Tag tone="neutro">{CATEGORY_LABEL[animal.category]}</Tag>}
      {animal.derivedTags.map((tag) => (
        <Tag key={tag} tone={DERIVED_TAG_TONE[tag]}>
          {derivedTagText(tag, animal.calvingCount, compact)}
        </Tag>
      ))}
      {animal.manualTags.map((tag) => (
        <Tag key={tag.id} tone="potrero">
          {tag.label}
        </Tag>
      ))}
      {animal.forSale ? <Tag tone="potrero">Disponible para venta</Tag> : null}
    </span>
  );
}

/**
 * «21/10/2026 · en 26 días». Una fecha ya pasada se dice como tal. En la tabla, «· en 26 d»
 * (06 §5.2).
 */
export function calvingText(date: IsoDate, today: IsoDate, compact = false): string {
  const days = daysBetween(today, date);
  if (days === 0) return `${formatDate(date)} · hoy`;
  const n = Math.abs(days);
  const unit = compact ? 'd' : n === 1 ? 'día' : 'días';
  return days > 0
    ? `${formatDate(date)} · en ${n} ${unit}`
    : `${formatDate(date)} · hace ${n} ${unit}`;
}

export function lastWeightText(animal: AnimalListItem): string {
  return animal.lastWeight === null ? '—' : formatWeight(animal.lastWeight.weightKg);
}

/** Alertas con ícono y texto, no solo color (06 §5.2). */
export function AlertsText({ animal }: { animal: AnimalListItem }) {
  if (animal.alerts.length === 0) return <span className="text-texto-2">—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {animal.alerts.map((alert) => (
        <span key={alert} className="inline-flex items-center gap-1 font-bold text-alerta">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          {ALERT_LABEL[alert]}
        </span>
      ))}
    </span>
  );
}
