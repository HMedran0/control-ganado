import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';

const BUTTON =
  'inline-flex size-14 items-center justify-center rounded-control border-2 border-texto-2 bg-superficie text-monte hover:bg-potrero-claro disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Cantidad pequeña con − y + (06 §6), como el número de crías de un parto (1 a 3).
 *
 * El valor está en un `<output>` que se anuncia al cambiar, y cada botón se deshabilita en su
 * límite para que no haya toques que no hacen nada.
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
}) {
  const id = useId();
  const labelId = `${id}-etiqueta`;

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <span id={labelId} className="font-bold">
        {label}
      </span>
      <div className="flex items-center gap-4">
        <button
          type="button"
          className={BUTTON}
          aria-label={`Quitar uno (${label})`}
          disabled={value <= min}
          onClick={() => {
            onChange(Math.max(min, value - 1));
          }}
        >
          <Minus aria-hidden="true" className="size-6" />
        </button>
        <output
          aria-live="polite"
          aria-labelledby={labelId}
          className="min-w-8 text-center font-cifras text-xl font-semibold tabular-nums"
        >
          {value}
        </output>
        <button
          type="button"
          className={BUTTON}
          aria-label={`Agregar uno (${label})`}
          disabled={value >= max}
          onClick={() => {
            onChange(Math.min(max, value + 1));
          }}
        >
          <Plus aria-hidden="true" className="size-6" />
        </button>
      </div>
    </div>
  );
}
