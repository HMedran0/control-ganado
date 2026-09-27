import { WifiOff } from 'lucide-react';
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** ¿El navegador cree que hay red? Cambia con los eventos `online` y `offline`. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}

/**
 * Aviso de conexión (06 §6, RNF-16). En F1 lo escrito espera a que vuelva la señal para
 * enviarse; en F2 irá a la cola local.
 *
 * La región `status` existe siempre, para que el lector de pantalla anuncie el cambio.
 */
export function ConnectionBanner({ online: forced }: { online?: boolean }) {
  const detected = useOnlineStatus();
  const online = forced ?? detected;

  return (
    <div role="status">
      {online ? null : (
        <p className="flex items-start gap-2 border-b-2 border-aviso bg-aviso-claro px-4 py-3 text-aviso-intenso">
          <WifiOff aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>
            <strong>Sin conexión.</strong> Lo que escribas se guardará cuando vuelva la señal.
          </span>
        </p>
      )}
    </div>
  );
}
