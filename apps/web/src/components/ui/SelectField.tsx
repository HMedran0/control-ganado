import { ChevronDown, CircleAlert } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

export type SelectFieldProps = ComponentProps<'select'> & {
  /** Etiqueta visible (06 §8). */
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
};

/**
 * Lista desplegable nativa, para cuando las opciones son muchas (razas, lotes). Con 2 a 4
 * opciones va `SegmentedChoice` (06 §6). La nativa abre el selector del sistema, que en el
 * celular es el más cómodo y ya es accesible.
 */
export function SelectField({
  label,
  error,
  hint,
  id,
  className = '',
  children,
  ...select
}: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint === undefined ? undefined : `${selectId}-ayuda`;
  const errorId = error === undefined ? undefined : `${selectId}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="font-bold">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          className={`min-h-touch w-full appearance-none rounded-control border-2 border-texto-2 bg-superficie pr-12 pl-3 text-base text-monte disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-alerta ${className}`}
          {...select}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-6 -translate-y-1/2 text-texto-2"
        />
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className="text-aux text-texto-2">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="flex items-start gap-1 text-aux font-bold text-alerta">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
