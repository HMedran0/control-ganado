import { Link, type LinkProps } from '@tanstack/react-router';

/**
 * Acción de un componente (AlertBanner, EmptyState): un enlace a otra pantalla o un botón.
 * El texto dice verbo + objeto: «Registrar vacuna» (06 §7).
 */
export type Action =
  | { readonly label: string; readonly to: LinkProps['to']; readonly onClick?: never }
  | { readonly label: string; readonly onClick: () => void; readonly to?: never };

/** Dibuja la acción como `<a>` o `<button>` según corresponda: nunca un botón que navega. */
export function ActionControl({ action, className }: { action: Action; className: string }) {
  if (action.to !== undefined) {
    return (
      <Link to={action.to} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}
