import * as RadixTabs from '@radix-ui/react-tabs';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export type TabItem<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly content: ReactNode;
};

/**
 * Pestañas (Radix Tabs): flechas para moverse entre pestañas, Tab para entrar al contenido.
 *
 * En móvil no caben todas: la barra se desplaza de lado **dentro de sí misma**, sin desplazar
 * la página, y al abrir la pestaña activa queda a la vista. Cada pestaña mide 48 px de alto
 * como mínimo (06 §3.4). La pestaña elegida se marca con subrayado, color y negrita.
 */
export function Tabs<T extends string>({
  label,
  value,
  onValueChange,
  items,
}: {
  /** Nombre del grupo para lectores de pantalla («Secciones de la ficha»). */
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  items: readonly TabItem<T>[];
}) {
  const list = useRef<HTMLDivElement>(null);

  // La pestaña activa se lleva a la vista moviendo solo la barra: `scrollIntoView` también
  // desplazaría la página hacia la barra, y quien entra a la ficha perdería el encabezado.
  useLayoutEffect(() => {
    const bar = list.current;
    const active = bar?.querySelector<HTMLElement>('[data-state="active"]');
    if (bar === null || active === null || active === undefined) return;
    const start = active.offsetLeft - bar.offsetLeft;
    const end = start + active.offsetWidth;
    if (start < bar.scrollLeft) bar.scrollLeft = Math.max(0, start - 16);
    else if (end > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = end - bar.clientWidth + 16;
  }, [value]);

  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => {
        const item = items.find((candidate) => candidate.value === next);
        if (item !== undefined) onValueChange(item.value);
      }}
      activationMode="manual"
    >
      <RadixTabs.List
        ref={list}
        aria-label={label}
        data-tabs-bar=""
        className="-mx-4 flex overflow-x-auto overscroll-x-contain border-b border-cerca px-4 [scrollbar-width:thin] lg:mx-0 lg:px-0"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className="-mb-px inline-flex min-h-touch shrink-0 items-center border-b-4 border-transparent px-4 whitespace-nowrap text-texto-2 hover:text-monte data-[state=active]:border-potrero data-[state=active]:font-bold data-[state=active]:text-potrero"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="pt-5 focus:outline-none">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
