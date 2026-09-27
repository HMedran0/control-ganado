import { Tag } from './Tag';

export type ChapetaSize = 's' | 'm' | 'l';

type ChapetaProps = {
  /** Código interno del animal (`26-045`). */
  readonly code: string;
  /** s: listas (56 px) · m: ficha (72 px) · l: jornada (96 px). */
  readonly size?: ChapetaSize;
  /**
   * El animal salió de la finca: la chapeta se apaga y se agrega esta etiqueta
   * («Vendido», «Retirado»). El código nunca se tacha (06-ux-ui.md §6).
   */
  readonly exitLabel?: string;
  /** Anima la entrada cuando cambia el código, como al leer un animal en la jornada. */
  readonly animated?: boolean;
  readonly className?: string;
};

/**
 * Ancho, letra para códigos de hasta 4 caracteres y letra mínima de cada tamaño.
 *
 * Las tres guardan la misma proporción (letra ≈ 0,4 del ancho, mínima ≈ 0,32) para verse de
 * la misma familia. La mínima de s son 18 px: en una lista al sol, un código más pequeño no se
 * lee. Con ella, `26-045` en Barlow Condensed ocupa unos 45 px y cabe en los 56 px del arete.
 */
export const CHAPETA_SIZES: Record<
  ChapetaSize,
  { readonly width: number; readonly fontSize: number; readonly minFontSize: number }
> = {
  s: { width: 56, fontSize: 22, minFontSize: 18 },
  m: { width: 72, fontSize: 30, minFontSize: 23 },
  l: { width: 96, fontSize: 40, minFontSize: 31 },
};

/** Alto sobre ancho de la silueta. */
const ASPECT = 1.2;

/** Tamaño de letra de un código: se achica si es largo, pero nunca por debajo del mínimo. */
export function chapetaFontSize(code: string, size: ChapetaSize): number {
  const { fontSize, minFontSize } = CHAPETA_SIZES[size];
  const scaled = Math.round(fontSize * Math.min(1, 4.5 / Math.max(code.length, 1)));
  return Math.max(minFontSize, scaled);
}

/**
 * Silueta del arete (viewBox 100 × 120): esquinas superiores muy redondeadas, inferiores casi
 * rectas y orificio arriba al centro (docs/referencia/prototipo/LEEME.md). También la usa el
 * logo de la aplicación.
 */
export function ChapetaShape({ muted = false }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 100 120" aria-hidden="true" className="absolute inset-0 size-full">
      <path
        d="M40 2 H60 A38 38 0 0 1 98 40 V112 A6 6 0 0 1 92 118 H8 A6 6 0 0 1 2 112 V40 A38 38 0 0 1 40 2 Z"
        className={muted ? 'fill-cerca stroke-texto-2' : 'fill-chapeta stroke-chapeta-borde'}
        strokeWidth={3}
      />
      <circle cx="50" cy="20" r="8" className="fill-sabana stroke-chapeta-borde" strokeWidth={2} />
    </svg>
  );
}

/**
 * Chapeta: el código del animal con la forma y el color de su arete (06 §3.1 y §6).
 *
 * Es el único elemento audaz de la interfaz. Para lectores de pantalla es una imagen con
 * nombre «Chapeta 26-045»; el código dibujado se oculta para no leerlo dos veces.
 */
export function Chapeta({
  code,
  size = 'm',
  exitLabel,
  animated = false,
  className = '',
}: ChapetaProps) {
  const { width } = CHAPETA_SIZES[size];
  const exited = exitLabel !== undefined;

  return (
    <span className={`inline-flex shrink-0 flex-col items-center gap-1 ${className}`}>
      <span
        role="img"
        aria-label={`Chapeta ${code}`}
        // `key` reinicia la animación cada vez que cambia el código.
        key={animated ? code : undefined}
        className={`relative inline-block ${animated ? 'animate-chapeta-entra' : ''}`}
        style={{ width, height: Math.round(width * ASPECT) }}
      >
        <ChapetaShape muted={exited} />
        <span
          aria-hidden="true"
          data-chapeta-code=""
          className="absolute inset-x-0 bottom-[12%] text-center font-cifras leading-none font-semibold whitespace-nowrap text-monte tabular-nums"
          style={{ fontSize: chapetaFontSize(code, size) }}
        >
          {code}
        </span>
      </span>
      {exited ? <Tag tone="neutro">{exitLabel}</Tag> : null}
    </span>
  );
}
