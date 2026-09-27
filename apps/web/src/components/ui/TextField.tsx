import { CircleAlert } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

export type TextFieldProps = ComponentProps<'input'> & {
  /** Etiqueta visible: nunca solo un placeholder (06 §8). */
  readonly label: string;
  /** Error del campo, junto a él (06 §8). */
  readonly error?: string | undefined;
  /** Texto de ayuda bajo el campo. */
  readonly hint?: ReactNode;
  /** Control dentro del campo, a la derecha (por ejemplo, mostrar la contraseña). */
  readonly trailing?: ReactNode;
};

/** Campo de texto con etiqueta, ayuda y error enlazados para lectores de pantalla. */
export function TextField({
  label,
  error,
  hint,
  trailing,
  id,
  className = '',
  ...input
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint === undefined ? undefined : `${inputId}-ayuda`;
  const errorId = error === undefined ? undefined : `${inputId}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="font-bold">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          // Borde en texto-2: los bordes de un control necesitan 3:1 de contraste (WCAG 1.4.11),
          // y el gris de las cercas no los alcanza.
          className={`min-h-touch w-full rounded-control border-2 border-texto-2 bg-superficie px-3 text-base text-monte aria-invalid:border-alerta ${trailing === undefined ? '' : 'pr-14'} ${className}`}
          {...input}
        />
        {trailing === undefined ? null : (
          <div className="absolute inset-y-0 right-0 flex items-center">{trailing}</div>
        )}
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
