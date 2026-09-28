import { formatDate, type AnimalDetail, type CodeHolderView } from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';

/** «Este número lo tuvo antes 5 · vendido el 12/03/2026». */
export function previousHolderText(holder: CodeHolderView): string {
  const how = holder.status === 'SOLD' ? 'vendido' : 'retirado';
  return holder.exitDate === null
    ? `Este número lo tuvo antes ${holder.code} · ${how}`
    : `Este número lo tuvo antes ${holder.code} · ${how} el ${formatDate(holder.exitDate)}`;
}

/** «Su número 5 lo tiene hoy otro animal». */
export function currentHolderText(code: string): string {
  return `Su número ${code} lo tiene hoy otro animal`;
}

/**
 * Número anterior (ANI-11 CA2 y CA3), con enlace a la ficha del otro animal. Cada animal
 * conserva su propio historial: el enlace lleva al otro, no mezcla nada (RN-33).
 */
export function CodeHistoryBanner({ animal }: { animal: AnimalDetail }) {
  const { previousHolder, currentHolder } = animal.codeHistory;
  const holder = previousHolder ?? currentHolder;
  if (holder === null) return null;
  const title =
    previousHolder === null ? currentHolderText(animal.code) : previousHolderText(previousHolder);
  return (
    <div className="flex items-start gap-3 rounded-panel border-2 border-info bg-info-claro p-4 text-info-intenso">
      <Info aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
      <div className="flex flex-col items-start gap-1">
        <p className="text-md leading-snug font-bold">{title}</p>
        <Link
          to="/animals/$id"
          params={{ id: holder.animalId }}
          className="-my-2 inline-flex min-h-touch items-center font-bold underline underline-offset-4"
        >
          Abrir la ficha de {holder.code}
        </Link>
      </div>
    </div>
  );
}
