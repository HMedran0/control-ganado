import { CircleAlert, Clock, Info, type LucideIcon } from 'lucide-react';

import { ActionControl, type Action } from './action';

export type AlertTone = 'alerta' | 'aviso' | 'info';

const TONES: Record<AlertTone, { box: string; text: string; icon: LucideIcon }> = {
  alerta: { box: 'bg-alerta-claro border-alerta', text: 'text-alerta-intenso', icon: CircleAlert },
  aviso: { box: 'bg-aviso-claro border-aviso', text: 'text-aviso-intenso', icon: Clock },
  info: { box: 'bg-info-claro border-info', text: 'text-info-intenso', icon: Info },
};

/**
 * Alerta accionable dentro de la ficha (06 §6): dice qué pasa y ofrece la acción que lo
 * resuelve («Aftosa vencida hace 6 días · Registrar vacuna»).
 *
 * No usa `role="alert"`: se muestra al abrir la ficha, no aparece de repente, y anunciarla
 * interrumpiría la lectura de la página.
 */
export function AlertBanner({
  tone,
  title,
  description,
  action,
}: {
  tone: AlertTone;
  title: string;
  description?: string;
  action?: Action;
}) {
  const style = TONES[tone];
  const Icon = style.icon;
  return (
    <div className={`flex items-start gap-3 rounded-panel border-2 p-4 ${style.box} ${style.text}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
      <div className="flex flex-col items-start gap-1">
        <p className="text-md leading-snug font-bold">{title}</p>
        {description === undefined ? null : <p>{description}</p>}
        {action === undefined ? null : (
          <ActionControl
            action={action}
            className="-my-2 inline-flex min-h-touch items-center font-bold underline underline-offset-4"
          />
        )}
      </div>
    </div>
  );
}
