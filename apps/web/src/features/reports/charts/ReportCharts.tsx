import { CATEGORY_LABEL, type ChartsReport } from '@hato/shared';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';

/**
 * Gráficas de Reportes (RPT-03, M8b), en SVG propio como la de pesos (M6): sin librería, cargadas
 * solo al abrir la página de gráficas. Marcas delgadas (línea de 2 px, puntos de 8 px, barras con
 * solo el extremo de datos redondeado y 2 px de separación entre tramos), rejilla tenue y texto
 * con tinta de texto, nunca del color de la serie. Cada marca se enfoca con el teclado y muestra
 * su valor; debajo de cada gráfica, la tabla con los mismos datos.
 *
 * El SVG mide lo mismo que su contenedor (una unidad = un píxel): con un `viewBox` fijo, el texto
 * se encogía a 6 px en el celular. Por eso el ancho se mide con `ResizeObserver`.
 *
 * Colores: `--color-serie-1` (hembras, y la serie única) y `--color-serie-2` (machos), validados
 * para daltonismo; nunca los de estado.
 */

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-09` → «sep 2026» (o «sep» si `short`). */
export function monthLabel(month: string, short = false): string {
  const [year, number] = month.split('-');
  const name = MONTHS[Number(number) - 1] ?? month;
  return short ? name : `${name} ${year ?? ''}`.trim();
}

const H = 240;
const PAD = { top: 22, right: 12, bottom: 30, left: 40 };
const PLOT_H = H - PAD.top - PAD.bottom;
const FONT = 13;

/** Ancho del contenedor en píxeles; 640 hasta que se mide (y en las pruebas sin navegador). */
function useChartWidth(): [RefObject<HTMLElement | null>, number] {
  const ref = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry?.contentRect.width ?? 0);
      if (measured > 0) setWidth(Math.max(280, measured));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}

/** Marcas redondas del eje: de 0 a un tope con 4 o 5 divisiones. */
function ticks(max: number): number[] {
  const top = Math.max(max, 1);
  const step =
    [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => top / s <= 5) ?? 2000;
  const result: number[] = [];
  for (let value = 0; value <= Math.ceil(top / step) * step; value += step) result.push(value);
  return result;
}

/** Rectángulo con solo las esquinas de arriba redondeadas (el extremo de datos de una columna). */
function topRounded(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
}

/** Rectángulo con solo las esquinas de la derecha redondeadas (barra horizontal). */
function rightRounded(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.min(radius, height / 2, width);
  return `M${x},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} H${x} Z`;
}

function Grid({
  values,
  y,
  width,
}: {
  values: readonly number[];
  y: (value: number) => number;
  width: number;
}) {
  return (
    <>
      {values.map((value) => (
        <g key={value}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(value)}
            y2={y(value)}
            stroke="var(--color-cerca)"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={y(value)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={FONT}
            fill="var(--color-texto-2)"
          >
            {value.toLocaleString('es-CO')}
          </text>
        </g>
      ))}
    </>
  );
}

/** Etiquetas de los meses: todas si caben; si no, una sí y una no, siempre con la última. */
function showMonth(index: number, count: number, slot: number): boolean {
  if (slot >= 36) return true;
  return index % 2 === (count - 1) % 2;
}

/** Lo que dice el tooltip debajo de la gráfica (también con el teclado). */
function Readout({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="min-h-6 text-texto-2">
      {children}
    </p>
  );
}

function Legend({ items }: { items: readonly { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-4" aria-label="Leyenda">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 rounded-sm"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Evolución del inventario: activos al cierre de cada mes (una serie, sin leyenda). */
export function InventoryChart({ data }: { data: ChartsReport['inventoryByMonth'] }) {
  const titleId = useId();
  const [ref, W] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const grid = ticks(Math.max(...data.map((row) => row.total)));
  const top = grid.at(-1) ?? 1;
  const x = (index: number) =>
    PAD.left + (data.length === 1 ? plotW / 2 : (index / (data.length - 1)) * plotW);
  const y = (value: number) => PAD.top + PLOT_H - (value / top) * PLOT_H;
  const path = data
    .map(
      (row, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(row.total).toFixed(1)}`,
    )
    .join(' ');
  const current = active === null ? null : (data[active] ?? null);
  const first = data[0];
  const last = data.at(-1);
  const slot = plotW / Math.max(1, data.length - 1);
  return (
    <figure ref={ref} className="flex flex-col gap-2">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="max-w-full touch-pan-y"
        role="group"
        aria-labelledby={titleId}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const svgX = ((event.clientX - rect.left) / rect.width) * W;
          const index = Math.round(((svgX - PAD.left) / plotW) * (data.length - 1));
          setActive(Math.min(data.length - 1, Math.max(0, index)));
        }}
        onPointerLeave={() => {
          setActive(null);
        }}
      >
        <title id={titleId}>
          {first === undefined || last === undefined
            ? 'Evolución del inventario'
            : `Evolución del inventario: ${first.total} animales en ${monthLabel(first.month)} y ${last.total} en ${monthLabel(last.month)}.`}
        </title>
        <Grid values={grid} y={y} width={W} />
        {data.map((row, index) =>
          showMonth(index, data.length, slot) ? (
            <text
              key={row.month}
              x={x(index)}
              y={H - 8}
              textAnchor={index === data.length - 1 ? 'end' : index === 0 ? 'start' : 'middle'}
              fontSize={FONT}
              fill="var(--color-texto-2)"
            >
              {monthLabel(row.month, true)}
            </text>
          ) : null,
        )}
        {current === null || active === null ? null : (
          <line
            x1={x(active)}
            x2={x(active)}
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
          stroke="var(--color-serie-1)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {data.map((row, index) => (
          <circle
            key={row.month}
            cx={x(index)}
            cy={y(row.total)}
            r={active === index ? 6 : 4}
            fill="var(--color-serie-1)"
            stroke="var(--color-superficie)"
            strokeWidth={2}
            tabIndex={0}
            role="img"
            aria-label={`${monthLabel(row.month)}: ${row.total} animales (${row.females} hembras, ${row.males} machos)`}
            onFocus={() => {
              setActive(index);
            }}
            onBlur={() => {
              setActive(null);
            }}
          />
        ))}
        {last === undefined ? null : (
          <text
            x={x(data.length - 1)}
            y={y(last.total) - 12}
            textAnchor="end"
            fontSize={FONT}
            fontWeight={700}
            fill="var(--color-monte)"
          >
            {last.total.toLocaleString('es-CO')}
          </text>
        )}
      </svg>
      <Readout>
        {current === null
          ? 'Pasa el dedo o el puntero sobre la línea para ver cada mes.'
          : `${monthLabel(current.month)}: ${current.total} animales · ${current.females} hembras · ${current.males} machos`}
      </Readout>
    </figure>
  );
}

/** Nacimientos por mes y sexo: columnas apiladas, hembras abajo, con leyenda. */
export function BirthsChart({ data }: { data: ChartsReport['birthsByMonth'] }) {
  const titleId = useId();
  const [ref, W] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const grid = ticks(Math.max(...data.map((row) => row.males + row.females)));
  const top = grid.at(-1) ?? 1;
  const slot = plotW / data.length;
  const barW = Math.min(32, slot * 0.6);
  const y = (value: number) => PAD.top + PLOT_H - (value / top) * PLOT_H;
  const h = (value: number) => (value / top) * PLOT_H;
  const current = active === null ? null : (data[active] ?? null);
  const total = data.reduce((sum, row) => sum + row.males + row.females, 0);
  return (
    <figure ref={ref} className="flex flex-col gap-2">
      <Legend
        items={[
          { label: 'Hembras', color: 'var(--color-serie-1)' },
          { label: 'Machos', color: 'var(--color-serie-2)' },
        ]}
      />
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="max-w-full"
        role="group"
        aria-labelledby={titleId}
      >
        <title
          id={titleId}
        >{`Nacimientos por mes y sexo en los últimos 12 meses: ${total} en total.`}</title>
        <Grid values={grid} y={y} width={W} />
        {data.map((row, index) => {
          const cx = PAD.left + slot * index + slot / 2;
          const sum = row.females + row.males;
          const left = cx - barW / 2;
          // El tramo de los machos va encima, con 2 px de separación; solo el de arriba se redondea.
          const gap = row.females > 0 && row.males > 0 ? 2 : 0;
          const maleHeight = Math.max(0, h(row.males) - gap);
          return (
            <g
              key={row.month}
              tabIndex={0}
              role="img"
              aria-label={`${monthLabel(row.month)}: ${sum} nacimientos (${row.females} hembras, ${row.males} machos)`}
              onPointerEnter={() => {
                setActive(index);
              }}
              onPointerLeave={() => {
                setActive(null);
              }}
              onFocus={() => {
                setActive(index);
              }}
              onBlur={() => {
                setActive(null);
              }}
            >
              {/* Zona de toque más grande que la columna. */}
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={PLOT_H} fill="transparent" />
              {row.females > 0 ? (
                row.males > 0 ? (
                  <rect
                    x={left}
                    y={y(row.females)}
                    width={barW}
                    height={h(row.females)}
                    fill="var(--color-serie-1)"
                  />
                ) : (
                  <path
                    d={topRounded(left, y(row.females), barW, h(row.females))}
                    fill="var(--color-serie-1)"
                  />
                )
              ) : null}
              {row.males > 0 && maleHeight > 0 ? (
                <path d={topRounded(left, y(sum), barW, maleHeight)} fill="var(--color-serie-2)" />
              ) : null}
              {sum > 0 && active === index ? (
                <text
                  x={cx}
                  y={y(sum) - 6}
                  textAnchor="middle"
                  fontSize={FONT}
                  fontWeight={700}
                  fill="var(--color-monte)"
                >
                  {sum}
                </text>
              ) : null}
              {showMonth(index, data.length, slot) ? (
                <text
                  x={cx}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={FONT}
                  fill="var(--color-texto-2)"
                >
                  {monthLabel(row.month, true)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <Readout>
        {current === null
          ? 'Toca una columna para ver el mes.'
          : `${monthLabel(current.month)}: ${current.females + current.males} nacimientos · ${current.females} hembras · ${current.males} machos`}
      </Readout>
    </figure>
  );
}

/** Distribución por categoría: barras horizontales, una serie, con el valor al final. */
export function CategoryChart({ data }: { data: ChartsReport['byCategory'] }) {
  const titleId = useId();
  const [ref, W] = useChartWidth();
  const max = Math.max(1, ...data.map((row) => row.count));
  const rowH = 36;
  const labelW = 88;
  const valueW = 48;
  const height = data.length * rowH;
  const total = data.reduce((sum, row) => sum + row.count, 0);
  return (
    <figure ref={ref}>
      <svg
        width={W}
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        className="max-w-full"
        role="group"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{`Animales activos por categoría: ${total} en total.`}</title>
        {data.map((row, index) => {
          const width = (row.count / max) * (W - labelW - valueW);
          const cy = index * rowH + rowH / 2;
          return (
            <g
              key={row.category}
              tabIndex={0}
              role="img"
              aria-label={`${CATEGORY_LABEL[row.category]}: ${row.count}`}
            >
              <text x={0} y={cy} dominantBaseline="middle" fontSize={14} fill="var(--color-monte)">
                {CATEGORY_LABEL[row.category]}
              </text>
              {row.count > 0 ? (
                <path
                  d={rightRounded(labelW, cy - 10, Math.max(width, 4), 20)}
                  fill="var(--color-serie-1)"
                />
              ) : null}
              <text
                x={labelW + Math.max(width, 0) + 8}
                y={cy}
                dominantBaseline="middle"
                fontSize={14}
                fontWeight={700}
                fill="var(--color-monte)"
              >
                {row.count.toLocaleString('es-CO')}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
