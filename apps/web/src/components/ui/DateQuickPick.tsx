import {
  addDays,
  errorDetail,
  formatDate,
  isAfter,
  isBefore,
  isIsoDate,
  type IsoDate,
} from '@hato/shared';
import { CircleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { SegmentedChoice } from './SegmentedChoice';

type Mode = 'hoy' | 'ayer' | 'otra';

const OPTIONS = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'ayer', label: 'Ayer' },
  { value: 'otra', label: 'Otra fecha' },
] as const;

export type DateQuickPickProps = {
  readonly label: string;
  readonly value: IsoDate;
  readonly onChange: (value: IsoDate) => void;
  /** «Hoy» en la finca: de `useToday()`, nunca del reloj del navegador (regla 6). */
  readonly today: IsoDate;
  readonly min?: IsoDate;
  /** Por defecto, hoy: los registros no pueden quedar en el futuro (DATE_IN_FUTURE). */
  readonly max?: IsoDate;
};

/**
 * Fecha con atajos (06 §6): Hoy · Ayer · Otra fecha, con Hoy por defecto. «Otra fecha» abre el
 * selector nativo del sistema, que en el celular es el más cómodo y ya es accesible.
 */
export function DateQuickPick({
  label,
  value,
  onChange,
  today,
  min,
  max = today,
}: DateQuickPickProps) {
  const yesterday = addDays(today, -1);
  const [mode, setMode] = useState<Mode>(
    value === today ? 'hoy' : value === yesterday ? 'ayer' : 'otra',
  );
  const [draft, setDraft] = useState<string>(value);
  const [error, setError] = useState<string | undefined>(undefined);
  // Al elegir «Otra fecha», el foco pasa al campo de fecha, que es lo siguiente que hay que
  // hacer. Solo cuando la persona lo eligió, no si la fecha inicial ya era otra.
  const focusOnMount = useRef(false);
  const id = useId();

  const pick = (next: Mode): void => {
    setMode(next);
    setError(undefined);
    if (next === 'hoy') onChange(today);
    else if (next === 'ayer') onChange(yesterday);
    else focusOnMount.current = true;
  };

  const typeDate = (text: string): void => {
    setDraft(text);
    if (!isIsoDate(text)) {
      setError('Elige una fecha completa.');
      return;
    }
    if (isAfter(text, max)) {
      setError(
        isAfter(text, today)
          ? errorDetail('DATE_IN_FUTURE')
          : `La fecha no puede ser posterior al ${formatDate(max)}.`,
      );
      return;
    }
    if (min !== undefined && isBefore(text, min)) {
      setError(`La fecha no puede ser anterior al ${formatDate(min)}.`);
      return;
    }
    setError(undefined);
    onChange(text);
  };

  return (
    <div className="flex flex-col gap-2">
      <SegmentedChoice label={label} options={OPTIONS} value={mode} onChange={pick} />
      {mode === 'otra' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-fecha`} className="font-bold">
            Otra fecha
          </label>
          <input
            ref={(node) => {
              if (node !== null && focusOnMount.current) {
                focusOnMount.current = false;
                node.focus();
              }
            }}
            id={`${id}-fecha`}
            type="date"
            value={draft}
            max={max}
            {...(min === undefined ? {} : { min })}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : `${id}-error`}
            onChange={(event) => {
              typeDate(event.target.value);
            }}
            className="min-h-touch w-full rounded-control border-2 border-texto-2 bg-superficie px-3 text-base text-monte aria-invalid:border-alerta"
          />
          {error === undefined ? null : (
            <p id={`${id}-error`} className="flex items-start gap-1 text-aux font-bold text-alerta">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
      ) : null}
      {/* Confirma la fecha en formato de Colombia; se anuncia al cambiar. */}
      <p aria-live="polite" className="text-aux text-texto-2">
        Fecha: <span className="font-bold text-monte">{formatDate(value)}</span>
      </p>
    </div>
  );
}
