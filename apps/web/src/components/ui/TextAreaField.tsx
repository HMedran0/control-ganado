import { CircleAlert } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

export type TextAreaFieldProps = ComponentProps<'textarea'> & {
  /** Etiqueta visible (06 §8). */
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
};

/** Texto largo (observaciones), con etiqueta, ayuda y error enlazados. */
export function TextAreaField({
  label,
  error,
  hint,
  id,
  className = '',
  rows = 3,
  ...textarea
}: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint === undefined ? undefined : `${fieldId}-ayuda`;
  const errorId = error === undefined ? undefined : `${fieldId}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="font-bold">
        {label}
      </label>
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy}
        className={`w-full rounded-control border-2 border-texto-2 bg-superficie px-3 py-2 text-base text-monte aria-invalid:border-alerta ${className}`}
        {...textarea}
      />
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
