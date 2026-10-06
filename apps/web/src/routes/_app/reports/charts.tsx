import { createFileRoute } from '@tanstack/react-router';

import { ChartsPage } from '../../../features/reports/charts/ChartsPage';

/** Gráficas (RPT-03): su propio chunk, cargado solo al abrirla. */
export const Route = createFileRoute('/_app/reports/charts')({
  component: ChartsPage,
});
