import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';

/**
 * Pregunta del día (06 §5.1): pregunta, resumen y cifra, con la fila completa enlazada al
 * listado filtrado. Va dentro de un `<li>`.
 *
 * La cifra se pinta en rojo solo con `tone="alerta"` (hay vencidas), y el resumen siempre dice
 * el porqué con palabras: el color nunca informa solo.
 */
export function QuestionRow({
  question,
  summary,
  value,
  tone = 'normal',
  to,
}: {
  question: string;
  summary?: string;
  /** Cifra ya formateada en es-CO («412», «$ 812 M»). */
  value: string;
  tone?: 'normal' | 'alerta';
  to: LinkProps['to'];
}) {
  return (
    <Link
      to={to}
      className="grid min-h-touch-primary grid-cols-[1fr_auto_auto] items-center gap-x-3 py-4 hover:bg-potrero-claro/40"
    >
      <span className="flex flex-col">
        <span className="text-md leading-snug font-bold">{question}</span>
        {summary === undefined ? null : <span className="text-texto-2">{summary}</span>}
      </span>
      <span
        className={`font-cifras text-cifra font-semibold tabular-nums ${tone === 'alerta' ? 'text-alerta' : 'text-monte'}`}
      >
        {value}
      </span>
      <ChevronRight aria-hidden="true" className="size-5 text-texto-2" />
    </Link>
  );
}
