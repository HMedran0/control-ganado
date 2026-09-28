import * as RadioGroup from '@radix-ui/react-radio-group';
import { Check, CircleAlert } from 'lucide-react';
import { useId } from 'react';

export type SegmentedOption<T extends string> = {
  readonly value: T;
  readonly label: string;
};

export type SegmentedChoiceProps<T extends string> = {
  /** Etiqueta visible del grupo («Sexo», «Tipo de parto»). */
  readonly label: string;
  /** De 2 a 4 opciones (06 §6); con más, una lista es mejor. */
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly error?: string | undefined;
  /** Ayuda bajo la etiqueta, como en los campos de texto. */
  readonly hint?: string | undefined;
  readonly name?: string;
  readonly disabled?: boolean;
};

/**
 * Grupo de botones grandes para elegir una opción entre pocas (06 §6): reemplaza a la lista
 * desplegable, que con guantes y al sol cuesta abrir.
 *
 * Para la accesibilidad es un grupo de opciones (`radiogroup`) de Radix: Tab entra al grupo,
 * las flechas cambian la opción y el lector anuncia «Macho, opción 1 de 2, seleccionada».
 * La elegida se marca con color, negrita **y** un ícono, no solo con color. El ícono va en la
 * esquina para no quitarle ancho al texto («Otra fecha» cabe en una línea en el celular).
 */
export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  name,
  disabled = false,
}: SegmentedChoiceProps<T>) {
  const id = useId();
  const labelId = `${id}-etiqueta`;
  const errorId = `${id}-error`;
  const hintId = `${id}-ayuda`;
  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((part) => part !== null)
      .join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="font-bold">
        {label}
      </span>
      {hint === undefined ? null : (
        <p id={hintId} className="text-aux text-texto-2">
          {hint}
        </p>
      )}
      <RadioGroup.Root
        value={value ?? ''}
        onValueChange={(next) => {
          const option = options.find((item) => item.value === next);
          if (option !== undefined) onChange(option.value);
        }}
        {...(name === undefined ? {} : { name })}
        disabled={disabled}
        orientation="horizontal"
        loop
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        className={`grid overflow-hidden rounded-control border-2 ${error === undefined ? 'border-texto-2' : 'border-alerta'}`}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            className="group relative flex min-h-touch-primary items-center justify-center border-l border-cerca bg-superficie px-2 text-base text-monte first:border-l-0 focus-visible:z-10 focus-visible:outline-offset-[-3px] disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:bg-potrero data-[state=checked]:font-bold data-[state=checked]:text-white"
          >
            <Check
              aria-hidden="true"
              className="absolute top-1.5 left-1.5 hidden size-4 group-data-[state=checked]:block"
            />
            {option.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {error === undefined ? null : (
        <p id={errorId} className="flex items-start gap-1 text-aux font-bold text-alerta">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
