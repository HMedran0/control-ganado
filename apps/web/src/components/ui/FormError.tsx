import { CircleAlert } from 'lucide-react';

/**
 * Error general de un formulario: qué pasó y cómo seguir (06 §7). Se anuncia al aparecer.
 * Con texto e ícono, no solo color (06 §8).
 */
export function FormError({ message }: { message: string | null }) {
  // El contenedor con `role="alert"` existe siempre: los lectores de pantalla anuncian mejor
  // un cambio de contenido que un elemento que aparece de la nada.
  return (
    // Vacío, el margen negativo compensa el espacio entre campos del formulario.
    <div role="alert" aria-atomic="true" className="empty:-mb-5">
      {message === null ? null : (
        <p className="flex items-start gap-2 rounded-control border-2 border-alerta bg-superficie p-3 font-bold text-alerta">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {message}
        </p>
      )}
    </div>
  );
}
