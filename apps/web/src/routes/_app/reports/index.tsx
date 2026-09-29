import { createFileRoute, Link } from '@tanstack/react-router';
import { Baby, ChevronRight } from 'lucide-react';

import { PageHeader } from '../../../components/layout/PageHeader';

export const Route = createFileRoute('/_app/reports/')({
  component: ReportsPage,
});

/**
 * Reportes (RPT-02). En M5 está el de nacimientos (NAC-01); el inventario, los grupos de edad del
 * ICA y la exportación a Excel llegan con M8.
 */
function ReportsPage() {
  return (
    <>
      <PageHeader title="Reportes" />
      <ul className="flex max-w-xl flex-col gap-2">
        <li>
          <Link
            to="/reports/births"
            className="flex min-h-touch items-center gap-3 rounded-control border-2 border-cerca p-4 hover:bg-potrero-claro"
          >
            <Baby aria-hidden="true" className="size-6 text-potrero" />
            <span className="flex flex-1 flex-col">
              <span className="font-bold">Nacimientos</span>
              <span className="text-texto-2">
                Por período: machos, hembras, débiles y muertos al nacer, con la madre de cada cría.
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-5" />
          </Link>
        </li>
      </ul>
      <p className="mt-4 max-w-xl text-texto-2">
        El inventario, el reporte de grupos de edad del ICA y la descarga en Excel llegan pronto.
      </p>
    </>
  );
}
