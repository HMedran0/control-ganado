import { isoDateFromInstant, type IsoDate } from '@hato/shared';
import { useEffect, useState } from 'react';

/** Zona de la finca: «hoy» es el día en Colombia, no el del navegador (CLAUDE.md, regla 6). */
export const FARM_TIME_ZONE = 'America/Bogota';

/**
 * Fecha de negocio de hoy en la finca.
 *
 * Es el único lugar de la web que consulta el instante actual, igual que el `Clock` de la API.
 * Los componentes reciben «hoy» por props, así las pruebas lo fijan sin tocar el reloj.
 */
export function todayInFarm(): IsoDate {
  // eslint-disable-next-line no-restricted-syntax -- única consulta del instante en la web
  return isoDateFromInstant(new Date(), FARM_TIME_ZONE);
}

/**
 * «Hoy» para los componentes. Se recalcula al volver a la pestaña: quien deja la aplicación
 * abierta de un día para otro no debe registrar con la fecha de ayer.
 */
export function useToday(): IsoDate {
  const [today, setToday] = useState(todayInFarm);

  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState === 'visible') setToday(todayInFarm());
    };
    document.addEventListener('visibilitychange', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return today;
}
