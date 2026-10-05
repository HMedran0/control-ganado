import { createFileRoute } from '@tanstack/react-router';

import { ScaleImportPage } from '../../../features/weights/ScaleImportPage';

/** Importar la sesión de pesaje de la báscula (PES-04, 06 §5.12). */
export const Route = createFileRoute('/_app/weights/import')({
  component: ScaleImportPage,
});
