import type { ComponentProps } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = ComponentProps<'button'> & {
  readonly variant?: Variant;
  /** Ancho completo: los botones principales en móvil (06 §3.4). */
  readonly block?: boolean;
};

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-potrero text-white hover:bg-monte',
  secondary: 'border-2 border-potrero bg-superficie text-potrero hover:bg-potrero-claro',
  ghost: 'text-potrero hover:bg-potrero-claro',
};

/**
 * Botón con objetivo táctil de 48 px como mínimo; el principal mide 56 px (06 §3.4).
 * El texto siempre dice verbo + objeto («Guardar contraseña», 06 §7).
 */
export function Button({
  variant = 'primary',
  block = false,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const size = variant === 'primary' ? 'min-h-touch-primary px-6' : 'min-h-touch px-4';
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-control text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${size} ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`}
      {...props}
    />
  );
}
