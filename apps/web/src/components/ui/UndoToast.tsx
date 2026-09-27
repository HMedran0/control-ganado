import * as Toast from '@radix-ui/react-toast';
import { CircleCheck } from 'lucide-react';
import { createContext, use, useCallback, useRef, useState, type ReactNode } from 'react';

/** Tiempo para deshacer (06 §6). */
export const UNDO_TOAST_MS = 6_000;

export type UndoToastInput = {
  /** Lo que se guardó, con el verbo repetido: «Vacuna registrada» (06 §7). */
  readonly message: string;
  readonly onUndo: () => void;
};

type Shown = UndoToastInput & { readonly id: number };

const ShowContext = createContext<((input: UndoToastInput) => void) | null>(null);

/**
 * Aviso de «Guardado · Deshacer» (06 §2.4 y §6): los registros de rutina se guardan de
 * inmediato y se pueden deshacer durante 6 segundos, en lugar de pedir confirmación antes.
 *
 * Usa Toast de Radix: se anuncia a los lectores de pantalla, se pausa con el mouse encima o con
 * el foco dentro, se cierra con Escape o deslizando hacia abajo, y F8 lleva el foco a él. Muestra
 * uno a la vez: un registro nuevo reemplaza al anterior.
 */
export function UndoToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Shown | null>(null);
  const [open, setOpen] = useState(false);
  const counter = useRef(0);

  const show = useCallback((input: UndoToastInput) => {
    counter.current += 1;
    setToast({ ...input, id: counter.current });
    setOpen(true);
  }, []);

  return (
    <Toast.Provider duration={UNDO_TOAST_MS} swipeDirection="down" label="Aviso">
      <ShowContext value={show}>{children}</ShowContext>
      {toast === null ? null : (
        <Toast.Root
          key={toast.id}
          open={open}
          onOpenChange={setOpen}
          className="flex items-center gap-3 rounded-panel bg-monte p-3 pl-4 text-white data-[state=closed]:animate-aviso-baja data-[state=open]:animate-aviso-sube data-[swipe=move]:translate-y-(--radix-toast-swipe-move-y)"
        >
          <CircleCheck aria-hidden="true" className="size-6 shrink-0 text-chapeta" />
          <Toast.Title className="flex-1 font-bold">{toast.message}</Toast.Title>
          <Toast.Action
            altText={`Deshacer: ${toast.message}`}
            onClick={toast.onUndo}
            className="inline-flex min-h-touch items-center rounded-control px-4 font-bold text-chapeta underline underline-offset-4 hover:bg-white/10"
          >
            Deshacer
          </Toast.Action>
        </Toast.Root>
      )}
      {/* Por encima de la barra inferior en móvil, abajo a la derecha en escritorio. */}
      <Toast.Viewport
        label="Avisos ({hotkey})"
        className="fixed inset-x-4 bottom-24 z-50 flex flex-col gap-2 outline-none lg:right-6 lg:bottom-6 lg:left-auto lg:w-96"
      />
    </Toast.Provider>
  );
}

/** Muestra el aviso con «Deshacer». Requiere `UndoToastProvider` arriba. */
export function useUndoToast(): (input: UndoToastInput) => void {
  const show = use(ShowContext);
  if (show === null) throw new Error('useUndoToast necesita un UndoToastProvider.');
  return show;
}
