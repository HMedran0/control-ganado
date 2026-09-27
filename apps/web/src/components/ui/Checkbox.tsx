import { Check } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** Texto visible; la casilla y el texto se pueden tocar. */
  readonly label: ReactNode;
  /** Detalle bajo el texto («Fiebre aftosa · ciclo oficial»). */
  readonly description?: ReactNode;
};

/**
 * Casilla de verificación con fila de 48 px como mínimo (06 §3.4): la etiqueta también
 * marca la casilla, así que no hace falta atinarle al cuadrito con guantes.
 *
 * Es un `<input type="checkbox">` nativo —accesible sin ARIA extra y compatible con
 * react-hook-form— con el cuadro dibujado encima. La marca es un ícono, no solo color.
 * La descripción queda fuera de la etiqueta y enlazada con `aria-describedby`: así el nombre
 * de la casilla es corto («Ciclo oficial del ICA») y el detalle se lee aparte.
 */
export function Checkbox({ label, description, id, className = '', ...input }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description === undefined ? undefined : `${inputId}-detalle`;

  return (
    <div
      className={`group grid grid-cols-[1.5rem_1fr] items-start gap-x-3 ${className}`}
    >
      {/* Deshabilitada, se atenúan la casilla y su etiqueta, no la descripción: el texto que
          explica por qué sigue necesitando contraste completo (axe, WCAG 1.4.3). */}
      <span className="relative mt-3 inline-flex size-6 group-has-disabled:opacity-60">
        <input
          id={inputId}
          type="checkbox"
          aria-describedby={descriptionId}
          className="peer size-6 cursor-pointer appearance-none rounded-[6px] border-2 border-texto-2 bg-superficie checked:border-potrero checked:bg-potrero disabled:cursor-not-allowed"
          {...input}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0.5 hidden size-5 text-white peer-checked:block"
        />
      </span>
      <label
        htmlFor={inputId}
        className="flex min-h-touch cursor-pointer items-center group-has-disabled:cursor-not-allowed group-has-disabled:opacity-60 has-[+p]:min-h-0 has-[+p]:pt-3"
      >
        {label}
      </label>
      {description === undefined ? null : (
        <p id={descriptionId} className="col-start-2 pb-2 text-aux text-texto-2">
          {description}
        </p>
      )}
    </div>
  );
}
