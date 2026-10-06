import { ChapetaShape } from '../ui/Chapeta';

/**
 * Logo de la aplicación: una chapeta pequeña con la «A» y el nombre, como en el prototipo
 * (docs/referencia/prototipo/05-listado-escritorio.png).
 *
 * La chapeta es decorativa; el nombre «Arreo» es el texto que se lee.
 */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-3">
      <span aria-hidden="true" className="relative inline-block" style={{ width: 30, height: 36 }}>
        <ChapetaShape />
        <span className="absolute inset-x-0 bottom-[10%] text-center font-cifras text-[15px] leading-none font-semibold text-monte">
          A
        </span>
      </span>
      <span className="text-lg leading-none font-bold text-monte">Arreo</span>
    </span>
  );
}
