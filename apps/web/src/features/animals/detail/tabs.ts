/**
 * Pestañas de la ficha (ANI-07). Viven aparte de la página para que la ruta valide `?tab=` sin
 * importar la ficha entera: así la ficha se descarga con su ruta y no en el paquete principal.
 */
export const DETAIL_TABS = [
  'resumen',
  'reproduccion',
  'sanidad',
  'pesos',
  'genealogia',
  'costos',
  'historial',
  'cambios',
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];
