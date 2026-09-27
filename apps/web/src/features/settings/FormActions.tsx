import { RefreshCw } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';

/**
 * Pie de los formularios de Configuración: error general, botón de guardar con verbo + objeto
 * («Guardar raza», 06 §7) y, si otra persona cambió el registro, la opción de recargar.
 */
export function FormActions({
  submitLabel,
  submitting,
  error,
  conflict,
  onReload,
}: {
  submitLabel: string;
  submitting: boolean;
  error: string | null;
  conflict: boolean;
  onReload: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      {conflict ? (
        <Button variant="secondary" onClick={onReload} className="self-start">
          <RefreshCw aria-hidden="true" className="size-5" />
          Recargar los datos
        </Button>
      ) : null}
      <Button type="submit" block disabled={submitting} className="lg:w-auto lg:self-start">
        {submitting ? 'Guardando…' : submitLabel}
      </Button>
    </div>
  );
}
