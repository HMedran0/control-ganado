import { daysBetween, formatDate, formatWeight, type IsoDate } from '@hato/shared';
import { useId, useState } from 'react';

/** Un punto de la serie: un pesaje válido. */
export type WeightPoint = { readonly id: string; readonly date: IsoDate; readonly kg: number };

const WIDTH = 640;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 36, left: 56 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/** Marcas «redondas» del eje de kilos: 4 o 5 divisiones de 10, 20, 25, 50 o 100 kg. */
function kgTicks(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  const span = Math.max(max - min, 10);
  const step = [5, 10, 20, 25, 50, 100, 200].find((candidate) => span / candidate <= 5) ?? 250;
  const lo = Math.max(0, Math.floor((min - span * 0.05) / step) * step);
  const hi = Math.ceil((max + span * 0.05) / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + 1e-9; value += step) ticks.push(value);
  return { lo, hi, ticks };
}

/**
 * Evolución del peso (PES-02 CA1): una sola serie, así que no lleva leyenda; el título de la
 * sección la nombra. SVG propio, sin librería (decisión de M6): línea de 2 px, puntos de 8 px en el
 * color de la marca, rejilla tenue y etiquetas con tinta de texto. Al pasar el puntero o enfocar
 * un punto con el teclado se ve la fecha y el peso; la tabla de pesajes de la pestaña es la vista
 * accesible de los mismos datos.
 */
export function WeightChart({ points }: { points: readonly WeightPoint[] }) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return null;

  const totalDays = Math.max(daysBetween(first.date, last.date), 1);
  const { lo, hi, ticks } = kgTicks(
    Math.min(...points.map((point) => point.kg)),
    Math.max(...points.map((point) => point.kg)),
  );
  const x = (date: IsoDate) =>
    points.length === 1
      ? PAD.left + PLOT_W / 2
      : PAD.left + (daysBetween(first.date, date) / totalDays) * PLOT_W;
  const y = (kg: number) => PAD.top + PLOT_H - ((kg - lo) / (hi - lo || 1)) * PLOT_H;
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${x(point.date).toFixed(1)},${y(point.kg).toFixed(1)}`,
    )
    .join(' ');
  // Fechas del eje: el primero, el último y, si caben, uno en medio.
  const dateTicks =
    points.length > 2
      ? [first, points[Math.floor(points.length / 2)] ?? first, last]
      : [first, last];
  const current = active === null ? null : (points[active] ?? null);

  /** Punto más cercano al puntero, por la horizontal (crosshair). */
  const nearest = (clientX: number, rect: DOMRect): number => {
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    let distance = Infinity;
    points.forEach((point, index) => {
      const delta = Math.abs(x(point.date) - svgX);
      if (delta < distance) {
        distance = delta;
        best = index;
      }
    });
    return best;
  };

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-pan-y"
        // Grupo, no imagen: los puntos se enfocan con el teclado.
        role="group"
        aria-labelledby={titleId}
        onPointerMove={(event) => {
          setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()));
        }}
        onPointerLeave={() => {
          setActive(null);
        }}
      >
        <title id={titleId}>
          {`Evolución del peso: de ${formatWeight(first.kg)} el ${formatDate(first.date)} a ${formatWeight(last.kg)} el ${formatDate(last.date)}, ${points.length} pesajes.`}
        </title>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-cerca)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={13}
              fill="var(--color-texto-2)"
            >
              {formatWeight(tick, { unit: false })}
            </text>
          </g>
        ))}
        <text
          x={8}
          y={PAD.top}
          fontSize={13}
          fill="var(--color-texto-2)"
          dominantBaseline="hanging"
        >
          kg
        </text>
        {dateTicks.map((point, index) => (
          <text
            key={`${point.id}-${index}`}
            x={x(point.date)}
            y={HEIGHT - 12}
            textAnchor={index === 0 ? 'start' : index === dateTicks.length - 1 ? 'end' : 'middle'}
            fontSize={13}
            fill="var(--color-texto-2)"
          >
            {formatDate(point.date)}
          </text>
        ))}
        {current === null ? null : (
          <line
            x1={x(current.date)}
            x2={x(current.date)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="var(--color-texto-2)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        <path
          d={path}
          fill="none"
          stroke="var(--color-potrero)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {points.map((point, index) => (
          <circle
            key={point.id}
            cx={x(point.date)}
            cy={y(point.kg)}
            r={index === active ? 6 : 4}
            fill="var(--color-potrero)"
            stroke="var(--color-superficie)"
            strokeWidth={2}
            tabIndex={0}
            role="img"
            aria-label={`${formatDate(point.date)}: ${formatWeight(point.kg)}`}
            className="outline-none focus-visible:stroke-[var(--color-chapeta)]"
            onFocus={() => {
              setActive(index);
            }}
            onBlur={() => {
              setActive(null);
            }}
          />
        ))}
      </svg>
      <figcaption aria-live="polite" className="min-h-6 font-bold">
        {current === null
          ? 'Pasa el dedo o el puntero por la gráfica para ver cada pesaje.'
          : `${formatDate(current.date)} · ${formatWeight(current.kg)}`}
      </figcaption>
    </figure>
  );
}
