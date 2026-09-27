import { formatDecimalEsCo, parseDecimalEsCo } from '@hato/shared';
import { useState } from 'react';

import { TextField, type TextFieldProps } from './TextField';

export type NumberFieldProps = Omit<
  TextFieldProps,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'leading' | 'trailing'
> & {
  /**
   * Valor como cadena decimal normalizada (`"452.5"`, `"1250000"`), o `null` si está vacío o
   * no es un número. **Nunca `number`**: el dinero no puede pasar por coma flotante (regla 7).
   */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  /** Unidad visible a la derecha: `kg`, `ml`. */
  readonly unit?: string;
  /** Pesos colombianos: `$` a la izquierda y sin decimales. */
  readonly currency?: boolean;
  /** Decimales permitidos. En pesos es siempre 0. */
  readonly maxDecimals?: number;
};

/**
 * Campo numérico (06 §6): teclado numérico del celular, unidad visible y formato es-CO
 * (`1.250.000`, `452,5`) al salir del campo.
 *
 * Mientras se escribe, se respeta lo que la persona teclea; la interpretación la hace
 * `parseDecimalEsCo` de `@hato/shared`, la misma que usarían la API o el móvil.
 */
export function NumberField({
  value,
  onChange,
  unit,
  currency = false,
  maxDecimals: requestedDecimals = 0,
  error,
  onBlur,
  onFocus,
  ...props
}: NumberFieldProps) {
  const maxDecimals = currency ? 0 : requestedDecimals;
  // Texto en edición; `null` cuando se muestra el valor formateado.
  const [draft, setDraft] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  const shown = draft ?? (value === null ? '' : formatDecimalEsCo(value, maxDecimals, true));

  return (
    <TextField
      {...props}
      type="text"
      inputMode={maxDecimals > 0 ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={shown}
      error={error ?? localError}
      leading={
        currency ? (
          <span aria-hidden="true" className="font-bold text-texto-2">
            $
          </span>
        ) : undefined
      }
      trailing={
        unit === undefined ? undefined : (
          <span aria-hidden="true" className="pr-4 text-texto-2">
            {unit}
          </span>
        )
      }
      onFocus={(event) => {
        setDraft(shown);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        setLocalError(undefined);
        onChange(text.trim() === '' ? null : parseDecimalEsCo(text, maxDecimals));
      }}
      onBlur={(event) => {
        const text = draft ?? '';
        if (text.trim() !== '' && parseDecimalEsCo(text, maxDecimals) === null) {
          // Lo escrito queda a la vista para corregirlo, con el porqué.
          setLocalError(invalidMessage(text, maxDecimals));
        } else {
          setDraft(null);
        }
        onBlur?.(event);
      }}
    />
  );
}

function invalidMessage(text: string, maxDecimals: number): string {
  // Con más decimales sí sería un número: el problema son los decimales.
  if (parseDecimalEsCo(text, 6) !== null) {
    return maxDecimals === 0
      ? 'Escribe el valor sin decimales.'
      : `Usa como máximo ${maxDecimals} ${maxDecimals === 1 ? 'decimal' : 'decimales'}.`;
  }
  return maxDecimals === 0
    ? 'Escribe solo números, por ejemplo 1.250.000.'
    : 'Escribe un número, por ejemplo 452,5.';
}
