import type { AnimalRef, SearchResultItem, Sex } from '@hato/shared';
import { CircleAlert, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { useSearch } from '../api';
import { STATUS_LABEL } from '../labels';

/**
 * Elegir un animal escribiendo su código, nombre o identificador (madre, padre, «Asociar a un
 * animal»). Es un combobox de la guía ARIA: flechas para moverse, Enter para elegir, Escape para
 * cerrar; el lector de pantalla anuncia cada opción con su código y nombre.
 *
 * Usa la búsqueda global, así que también encuentra animales que ya salieron de la finca: la
 * madre de una cría del inventario inicial puede estar vendida.
 */
export function AnimalPicker({
  label,
  value,
  onChange,
  sex,
  excludeId,
  error,
  hint,
}: {
  label: string;
  value: AnimalRef | null;
  onChange: (value: AnimalRef | null) => void;
  /** Solo hembras (madre) o solo machos (padre). */
  sex?: Sex;
  /** El propio animal, que no puede ser su madre ni su padre. */
  excludeId?: string;
  error?: string | undefined;
  hint?: string;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Espera a que se deje de escribir para no consultar con cada tecla.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  const search = useSearch(query);
  const options: SearchResultItem[] = (search.data?.items ?? [])
    .filter((item) => (sex === undefined || item.sex === sex) && item.id !== excludeId)
    .slice(0, 8);
  const listId = `${id}-opciones`;
  const errorId = `${id}-error`;
  const hintId = `${id}-ayuda`;

  const choose = (item: SearchResultItem): void => {
    onChange({ id: item.id, code: item.code, name: item.name });
    setText('');
    setQuery('');
    setOpen(false);
  };

  if (value !== null) {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-bold">{label}</span>
        <div className="flex min-h-touch items-center justify-between gap-2 rounded-control border-2 border-texto-2 bg-superficie pl-3">
          <span>{value.name === null ? value.code : `${value.code} · ${value.name}`}</span>
          <Button
            variant="ghost"
            aria-label={`Quitar ${label.toLowerCase()} ${value.code}`}
            onClick={() => {
              onChange(null);
            }}
          >
            <X aria-hidden="true" className="size-5" />
            Quitar
          </Button>
        </div>
      </div>
    );
  }

  const showList = open && query.length > 0;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={`${id}-campo`} className="font-bold">
        {label}
      </label>
      <input
        id={`${id}-campo`}
        role="combobox"
        type="text"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={
          showList && options[active] !== undefined ? `${listId}-${active}` : undefined
        }
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        placeholder="Código, nombre o chapeta"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => {
          // Deja terminar el clic sobre una opción antes de cerrar.
          setTimeout(() => {
            setOpen(false);
          }, 150);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.min(current + 1, Math.max(options.length - 1, 0)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter' && showList) {
            const option = options[active];
            if (option !== undefined) {
              event.preventDefault();
              choose(option);
            }
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="min-h-touch w-full rounded-control border-2 border-texto-2 bg-superficie px-3 text-base text-monte placeholder:text-texto-2 aria-invalid:border-alerta"
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-aux text-texto-2">
          {hint}
        </p>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!showList}
        className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-control border-2 border-texto-2 bg-superficie shadow-lg"
      >
        {options.length === 0 ? (
          <li role="option" aria-selected={false} aria-disabled className="p-3 text-texto-2">
            {search.isFetching ? 'Buscando…' : 'Ningún animal coincide.'}
          </li>
        ) : (
          options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              className={`flex min-h-touch cursor-pointer items-center gap-2 px-3 ${index === active ? 'bg-potrero-claro' : ''}`}
            >
              <span className="font-bold">{option.code}</span>
              {option.name === null ? null : <span>{option.name}</span>}
              {option.status === 'ACTIVE' ? null : (
                <span className="text-texto-2">· {STATUS_LABEL[option.status]}</span>
              )}
            </li>
          ))
        )}
      </ul>
      {error === undefined ? null : (
        <p id={errorId} className="flex items-start gap-1 text-aux font-bold text-alerta">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
