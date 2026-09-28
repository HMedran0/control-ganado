import type { Warning } from '@hato/shared';

/**
 * Estado que viaja con la navegación al guardar un animal: las advertencias de la API
 * (`DAM_AGE_LOW`, `RFID_FOREIGN_COUNTRY`…) y el mensaje de lo guardado. La ficha los muestra al
 * llegar; no van en la URL porque no tiene sentido compartirlos ni volver a verlos al recargar.
 */
declare module '@tanstack/react-router' {
  // Ampliar la interfaz de la biblioteca exige `interface`: un `type` no se fusiona.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface HistoryState {
    animalWarnings?: readonly Warning[];
    animalSaved?: string;
  }
}

export {};
