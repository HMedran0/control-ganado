import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Diálogo modal (Radix Dialog): atrapa el foco, se cierra con Escape y devuelve el foco al
 * control que lo abrió. En móvil sube desde abajo, al alcance del pulgar (06 §8); en escritorio
 * queda centrado.
 *
 * Se usa para tareas cortas sobre la pantalla actual: operaciones en lote, identificadores,
 * filtros. Las acciones graves (salida, archivo) llevan su propia confirmación en M4c.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Una línea que explica qué va a pasar; los lectores de pantalla la leen al abrir. */
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-monte/50" />
        <RadixDialog.Content
          // Sin descripción, Radix pide `aria-describedby={undefined}` explícito.
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-panel bg-superficie shadow-lg focus:outline-none lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:w-[32rem] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-panel"
        >
          <div className="flex items-start justify-between gap-3 border-b border-cerca p-4">
            <div className="flex flex-col gap-1">
              <RadixDialog.Title className="text-md font-bold">{title}</RadixDialog.Title>
              {description === undefined ? null : (
                <RadixDialog.Description className="text-texto-2">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Cerrar"
              className="-m-2 inline-flex size-12 shrink-0 items-center justify-center rounded-control text-texto-2 hover:bg-potrero-claro"
            >
              <X aria-hidden="true" className="size-6" />
            </RadixDialog.Close>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
