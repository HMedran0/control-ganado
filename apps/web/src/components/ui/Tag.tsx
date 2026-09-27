import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type TagTone = 'neutro' | 'potrero' | 'info' | 'aviso' | 'alerta';

/** Fondo claro del color semántico y texto en su tono (contrastes en tokens.test.ts). */
const TONES: Record<TagTone, string> = {
  neutro: 'bg-neutro-claro text-texto-2',
  potrero: 'bg-potrero-claro text-potrero',
  info: 'bg-info-claro text-info',
  aviso: 'bg-aviso-claro text-aviso',
  alerta: 'bg-alerta-claro text-alerta',
};

/**
 * Etiqueta de clasificación (Preñada, Parida · 4, Lote Sabana). Siempre lleva texto: el
 * color solo refuerza, nunca informa por sí solo (06 §8, daltonismo).
 */
export function Tag({
  tone = 'neutro',
  icon: Icon,
  children,
}: {
  tone?: TagTone;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-aux leading-6 font-bold whitespace-nowrap ${TONES[tone]}`}
    >
      {Icon === undefined ? null : <Icon aria-hidden="true" className="size-4 shrink-0" />}
      {children}
    </span>
  );
}
