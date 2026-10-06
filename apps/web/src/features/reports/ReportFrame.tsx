import { REPORT_LABEL, type ReportName } from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, FileSpreadsheet } from 'lucide-react';
import type { ReactNode } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { isApiError } from '../../lib/api/errors';
import { useReportDownload } from './api';

/**
 * Marco común de un reporte (06 §5.19): volver a Reportes, título y para qué sirve, los filtros,
 * «Descargar en Excel» con los mismos filtros (RPT-02 CA1) y el contenido.
 */
export function ReportFrame({
  report,
  exportPath,
  filters,
  children,
}: {
  report: ReportName;
  /** `null` mientras los filtros no son válidos. */
  exportPath: string | null;
  filters?: ReactNode;
  children: ReactNode;
}) {
  const download = useReportDownload();
  const label = REPORT_LABEL[report];
  return (
    <>
      <Link
        to="/reports"
        className="mb-2 inline-flex min-h-touch items-center gap-1 font-bold text-potrero underline underline-offset-4"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Reportes
      </Link>
      <PageHeader title={label.title}>{label.description}</PageHeader>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-4">
          {filters}
          <Button
            variant="secondary"
            disabled={exportPath === null || download.isPending}
            onClick={() => {
              if (exportPath !== null) download.mutate(exportPath);
            }}
          >
            <FileSpreadsheet aria-hidden="true" className="size-5" />
            {download.isPending ? 'Preparando…' : 'Descargar en Excel'}
          </Button>
        </div>
        {download.isError ? (
          <FormError
            message={
              isApiError(download.error)
                ? download.error.detail
                : 'No se pudo descargar el archivo.'
            }
          />
        ) : null}
        {children}
      </div>
    </>
  );
}

/** Estados de carga y error de la consulta de un reporte. */
export function ReportStatus({ isPending, error }: { isPending: boolean; error: unknown }) {
  if (isPending) {
    return (
      <p role="status" className="text-texto-2">
        Cargando reporte…
      </p>
    );
  }
  if (error === null || error === undefined) return null;
  return <FormError message={isApiError(error) ? error.detail : 'No pudimos cargar el reporte.'} />;
}
