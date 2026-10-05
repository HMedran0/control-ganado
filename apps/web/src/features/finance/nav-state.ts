/**
 * Estado que viaja con la navegación en Finanzas: el mensaje de lo guardado y los animales
 * elegidos en el listado para cargarles un gasto. No van en la URL: la selección puede ser de
 * miles de animales y no tiene sentido compartirla ni recuperarla al recargar.
 */
declare module '@tanstack/react-router' {
  // Ampliar la interfaz de la biblioteca exige `interface`: un `type` no se fusiona.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface HistoryState {
    financeSaved?: string;
    expenseAnimalIds?: readonly string[];
  }
}

export {};
