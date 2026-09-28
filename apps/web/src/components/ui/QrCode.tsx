import { useMemo, type CSSProperties } from 'react';
import { encode } from 'uqr';

/**
 * Código QR en SVG, dibujado en el navegador (IDN-03). Un solo `<path>` con un cuadrado por
 * módulo oscuro: nítido al imprimir en cualquier tamaño y sin `innerHTML`.
 *
 * Corrección de errores M (15 %): aguanta una etiqueta rayada o manchada en el corral sin que el
 * código crezca tanto como con Q o H.
 */
export function QrCode({
  value,
  label,
  className = '',
  style,
}: {
  /** Texto que codifica: la URL de la ficha, sin datos del animal. */
  value: string;
  /** Nombre accesible («QR de la ficha de 087»). */
  label: string;
  className?: string;
  /** Tamaño exacto, por ejemplo en milímetros para la hoja de etiquetas. */
  style?: CSSProperties;
}) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
