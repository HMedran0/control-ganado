import type { AnimalDetail, Warning } from '@hato/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { CircleAlert, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { ZodType } from 'zod';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormError } from '../../components/ui/FormError';
import { isApiError } from '../../lib/api/errors';
import { useAnimal } from '../animals/api';
import '../animals/nav-state';

/**
 * Piezas comunes de las pantallas de servicio, palpación, aborto y parto.
 *
 * Los formularios tienen campos cómodos para la pantalla (pesos como texto del `NumberField`,
 * toro elegido de una lista) y validan con el esquema de shared, sin copiar sus reglas: el
 * resolver arma el cuerpo, lo valida y devuelve cada error a su campo, también los anidados
 * (`calves.1.code`).
 */
export function schemaResolver<V extends FieldValues, O>(
  schema: ZodType<O>,
  build: (values: V) => unknown,
  /**
   * Campo del cuerpo → campo del formulario, cuando se llaman distinto: un mapa del primer tramo
   * (`sireId` → `sire`) o una función de la ruta completa (`calves.0.birthWeightKg`).
   */
  rename: Readonly<Record<string, string>> | ((path: string) => string) = {},
): Resolver<V, unknown, O> {
  return (values) => {
    const result = schema.safeParse(build(values));
    if (result.success) return { values: result.data, errors: {} };
    const errors: Record<string, unknown> = {};
    for (const issue of result.error.issues) {
      setPath(errors, formPath(issue.path.map(String), rename), issue.message);
    }
    return { values: {}, errors: errors as FieldErrors<V> };
  };
}

function formPath(
  path: string[],
  rename: Readonly<Record<string, string>> | ((path: string) => string),
): string[] {
  if (path.length === 0) return ['root'];
  if (typeof rename === 'function') return rename(path.join('.')).split('.');
  const first = path[0];
  const renamed = first === undefined ? undefined : rename[first];
  return renamed === undefined ? path : [renamed, ...path.slice(1)];
}

/** Pone el primer mensaje de cada campo en el objeto de errores anidado de react-hook-form. */
export function setPath(target: Record<string, unknown>, path: readonly string[], message: string) {
  let node = target;
  for (const [index, key] of path.entries()) {
    if (index === path.length - 1) {
      node[key] ??= { type: 'validation', message };
      return;
    }
    node[key] ??= /^\d+$/.test(path[index + 1] ?? '') ? [] : {};
    node = node[key] as Record<string, unknown>;
  }
}

/** Texto → `string | undefined`, como llega a la API un campo opcional vacío. */
export function optional(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Peso del `NumberField` (texto decimal) → número para la API. */
export function weight(text: string | null): number | undefined {
  return text === null || text === '' ? undefined : Number(text);
}

/** Vuelve a la ficha de la hembra, en Reproducción, con el mensaje y las advertencias. */
export function useBackToDam() {
  const navigate = useNavigate();
  return (damId: string, message: string, warnings: readonly Warning[] = []) =>
    navigate({
      to: '/animals/$id',
      params: { id: damId },
      search: { tab: 'reproduccion' },
      state: { animalSaved: message, animalWarnings: warnings },
    });
}

/**
 * Carga la hembra de la pantalla. Solo las hembras activas tienen servicio, palpación, aborto y
 * parto (RN-02, RN-09); para las demás se explica por qué, sin mostrar un formulario que la API
 * rechazaría.
 */
export function DamPage({
  id,
  title,
  children,
}: {
  id: string;
  title: (name: string) => string;
  children: (animal: AnimalDetail) => ReactNode;
}) {
  const animal = useAnimal(id);
  const navigate = useNavigate();
  if (animal.isPending) return <p className="text-texto-2">Cargando…</p>;
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
        message={isApiError(animal.error) ? animal.error.detail : 'No pudimos cargar el animal.'}
      />
    );
  }
  const data = animal.data;
  const name = data.name === null ? data.code : `${data.code} · ${data.name}`;
  const unavailable =
    data.sex !== 'FEMALE'
      ? 'Esta acción solo aplica a hembras.'
      : data.status !== 'ACTIVE'
        ? 'El animal ya no está en la finca; revierte la salida o restáuralo para registrarle eventos.'
        : null;
  return (
    <>
      <PageHeader title={title(name)} />
      {unavailable === null ? (
        children(data)
      ) : (
        <EmptyState
          icon={CircleAlert}
          title={unavailable}
          description="Vuelve a la ficha del animal."
          action={{
            label: 'Abrir la ficha',
            onClick: () => {
              void navigate({ to: '/animals/$id', params: { id: data.id } });
            },
          }}
        />
      )}
    </>
  );
}

/**
 * Error de guardado con la salida que ofrece la API: la preñez abierta que hay que cerrar
 * (`PREGNANCY_ALREADY_OPEN`, REP-01 CA3) o el animal que ya tiene un código.
 */
export function SaveError({ error, damId }: { error: unknown; damId: string }) {
  if (error === null || error === undefined) return null;
  const detail = isApiError(error) ? error.detail : 'Ocurrió un error inesperado.';
  const context = isApiError(error) ? error.context : undefined;
  const code = isApiError(error) ? error.code : null;
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-control border-2 border-alerta bg-alerta-claro p-3 text-alerta-intenso"
    >
      <p className="flex items-start gap-2 font-bold">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        {detail}
      </p>
      {code === 'PREGNANCY_ALREADY_OPEN' ? (
        <Link
          to="/animals/$id"
          params={{ id: damId }}
          search={{ tab: 'reproduccion' }}
          className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
        >
          Ver la preñez abierta
        </Link>
      ) : null}
      {context?.animalId === undefined ? null : (
        <Link
          to="/animals/$id"
          params={{ id: context.animalId }}
          className="inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
        >
          Abrir la ficha de {context.animalCode ?? 'ese animal'}
        </Link>
      )}
    </div>
  );
}
