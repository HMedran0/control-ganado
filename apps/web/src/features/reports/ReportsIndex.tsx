import {
  DEFAULT_FARM_SETTINGS,
  REPORT,
  REPORT_LABEL,
  reportOrder,
  type ReportName,
} from '@hato/shared';
import { Link } from '@tanstack/react-router';
import {
  Baby,
  CalendarCheck,
  ChartLine,
  ChevronRight,
  ClipboardList,
  LogOut,
  Shield,
  Syringe,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { useRequiredSession } from '../../lib/auth/context';
import { PRODUCTION_SYSTEM_LABEL } from '../dashboard/labels';
import { useFarm } from '../settings/api';

const ICON: Readonly<Record<ReportName, LucideIcon>> = {
  inventory: ClipboardList,
  'inventory-ica': Shield,
  'cycle-progress': CalendarCheck,
  births: Baby,
  vaccinations: Syringe,
  'vaccination-pending': Syringe,
  'calvings-upcoming': Users,
  exits: LogOut,
  economic: Wallet,
};

const ROUTE = {
  inventory: '/reports/inventory',
  'inventory-ica': '/reports/inventory-ica',
  'cycle-progress': '/reports/cycle-progress',
  births: '/reports/births',
  vaccinations: '/reports/vaccinations',
  'vaccination-pending': '/reports/vaccination-pending',
  'calvings-upcoming': '/reports/calvings-upcoming',
  exits: '/reports/exits',
} as const satisfies Record<Exclude<ReportName, 'economic'>, string>;

/** A dónde lleva cada reporte; el económico es la pestaña Reporte de Finanzas (ECO-06). */
function ReportLink({ report, children }: { report: ReportName; children: React.ReactNode }) {
  const className =
    'flex min-h-touch items-center gap-3 rounded-control border-2 border-cerca p-4 hover:bg-potrero-claro';
  if (report === REPORT.ECONOMIC) {
    return (
      <Link to="/finance" search={{ tab: 'reporte' }} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <Link to={ROUTE[report]} className={className}>
      {children}
    </Link>
  );
}

/**
 * Reportes (RPT-02, RPT-03; 06 §5.19): primero las gráficas y después los reportes en el orden
 * del sistema productivo de la finca (CFG-03 CA1, `reportOrder` [Validar]). El económico solo
 * aparece para el ADMIN (RN-20). Cada reporte se ve en pantalla y se descarga en Excel.
 */
export function ReportsIndex() {
  const session = useRequiredSession();
  const farm = useFarm();
  const system = farm.data?.settings.productionSystem ?? DEFAULT_FARM_SETTINGS.productionSystem;
  const reports = reportOrder(system).filter(
    (report) => report !== REPORT.ECONOMIC || session.role === 'ADMIN',
  );
  return (
    <>
      <PageHeader title="Reportes">
        En el orden de una finca de {PRODUCTION_SYSTEM_LABEL[system].toLowerCase()}. Todos se
        descargan en Excel.
      </PageHeader>
      <ul aria-label="Reportes disponibles" className="flex max-w-xl flex-col gap-2">
        <li>
          <Link
            to="/reports/charts"
            className="flex min-h-touch items-center gap-3 rounded-control border-2 border-cerca p-4 hover:bg-potrero-claro"
          >
            <ChartLine aria-hidden="true" className="size-6 text-potrero" />
            <span className="flex flex-1 flex-col">
              <span className="font-bold">Gráficas</span>
              <span className="text-texto-2">
                Animales mes a mes, nacimientos por mes y sexo, y categorías.
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-5" />
          </Link>
        </li>
        {reports.map((report) => {
          const Icon = ICON[report];
          return (
            <li key={report}>
              <ReportLink report={report}>
                <Icon aria-hidden="true" className="size-6 text-potrero" />
                <span className="flex flex-1 flex-col">
                  <span className="font-bold">{REPORT_LABEL[report].title}</span>
                  <span className="text-texto-2">{REPORT_LABEL[report].description}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-5" />
              </ReportLink>
            </li>
          );
        })}
      </ul>
    </>
  );
}
