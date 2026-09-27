import { Nfc, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { isEditable, RFID_TARGET_ATTRIBUTE, useRfidReader } from '../../lib/rfid/useRfidReader';

export type SearchSource = 'teclado' | 'lector';

export type SearchBarProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Búsqueda confirmada: con Enter, con el botón o con una lectura del lector RFID. */
  readonly onSearch: (query: string, source: SearchSource) => void;
  /** Nombre del campo para lectores de pantalla (la etiqueta no se ve; lo aprobado en M2b). */
  readonly label?: string;
  readonly placeholder?: string;
  /** Atajo «/» para enfocar la búsqueda (escritorio, 06 §4). */
  readonly shortcut?: boolean;
  /**
   * Listo para leer (jornada): borde amarillo de chapeta y texto que invita a leer el chip
   * (06 §5.5). El lector funciona siempre; esto solo lo hace visible.
   */
  readonly readerReady?: boolean;
};

/**
 * Búsqueda de animales (06 §6): acepta cualquier identificador escrito y las lecturas del
 * lector RFID en modo teclado, aunque el campo no tenga el foco (04 §6).
 */
export function SearchBar({
  value,
  onChange,
  onSearch,
  label = 'Buscar animal',
  placeholder,
  shortcut = false,
  readerReady = false,
}: SearchBarProps) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [announcement, setAnnouncement] = useState('');

  useRfidReader({
    onRead: (code) => {
      onChange(code);
      setAnnouncement(`Chip leído: ${code}.`);
      onSearch(code, 'lector');
    },
  });

  useEffect(() => {
    if (!shortcut) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      // Quien está escribiendo una «/» en otro campo no quiere saltar a la búsqueda.
      if (event.target instanceof HTMLElement && isEditable(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shortcut]);

  const Icon = readerReady ? Nfc : Search;

  return (
    <form
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (query !== '') onSearch(query, 'teclado');
      }}
    >
      <label htmlFor={`${id}-campo`} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Icon
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 ${readerReady ? 'text-aviso' : 'text-texto-2'}`}
        />
        <input
          ref={input}
          id={`${id}-campo`}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          {...{ [RFID_TARGET_ATTRIBUTE]: '' }}
          value={value}
          placeholder={
            placeholder ?? (readerReady ? 'Leer chip o escribir código' : 'Código, chapeta o chip')
          }
          onChange={(event) => {
            onChange(event.target.value);
          }}
          aria-describedby={shortcut ? `${id}-atajo` : undefined}
          className={`min-h-touch-primary w-full rounded-panel bg-superficie pl-13 text-base text-monte lg:text-md ${shortcut ? 'pr-12' : 'pr-4'} placeholder:text-texto-2 ${
            readerReady ? 'border-4 border-chapeta' : 'border-2 border-texto-2'
          }`}
        />
        {shortcut ? (
          <>
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 rounded border border-texto-2 px-2 font-sans text-aux text-texto-2 lg:inline"
            >
              /
            </kbd>
            <span id={`${id}-atajo`} className="sr-only">
              Atajo: tecla barra.
            </span>
          </>
        ) : null}
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </form>
  );
}
