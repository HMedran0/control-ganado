import { HardDriveDownload } from 'lucide-react';

import { RequireRole } from '../../components/layout/RequireRole';
import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { isApiError } from '../../lib/api/errors';
import { SettingsHeader } from '../settings/SettingsHeader';
import { useFullExport } from './api';

/**
 * Configuración → Exportar todos los datos (BAK-02, M8b, 06 §5.19). Un ZIP con un Excel por tipo
 * de registro y un LEEME que explica cada columna: la historia completa de la finca, para tenerla
 * sin depender de Arreo. Tres por hora por finca; si hay otra exportación en curso en el servidor,
 * la API pide esperar un minuto.
 */
export function ExportPage() {
  const exporter = useFullExport();
  return (
    <RequireRole roles={['ADMIN']} title="Exportar todos los datos">
      <SettingsHeader title="Exportar todos los datos">
        Descarga la historia completa de la finca para guardarla donde quieras.
      </SettingsHeader>
      <section className="flex max-w-xl flex-col gap-4">
        <ul className="list-disc pl-6 text-texto-2">
          <li>
            Un archivo comprimido (ZIP) con un Excel por cada tipo de registro: animales, chapetas y
            chips, preñeces y partos, vacunas, tratamientos, pesos, gastos, ventas, catálogos,
            usuarios y auditoría.
          </li>
          <li>Trae también lo archivado y lo anulado, marcado como tal.</li>
          <li>El archivo LEEME.txt explica qué trae cada Excel y cada columna.</li>
          <li>No trae contraseñas.</li>
          <li>Puedes exportar hasta 3 veces por hora.</li>
        </ul>
        <Button
          className="self-start"
          disabled={exporter.isPending}
          onClick={() => {
            exporter.mutate();
          }}
        >
          <HardDriveDownload aria-hidden="true" className="size-5" />
          {exporter.isPending ? 'Preparando el archivo…' : 'Descargar todo (ZIP)'}
        </Button>
        {exporter.isPending ? (
          <p role="status" className="text-texto-2">
            Puede tardar un minuto con una conexión lenta. No cierres esta página.
          </p>
        ) : null}
        {exporter.isSuccess ? (
          <p role="status" className="font-bold text-potrero">
            Listo: el archivo quedó en tus descargas.
          </p>
        ) : null}
        {exporter.isError ? (
          <FormError
            message={
              isApiError(exporter.error)
                ? exporter.error.detail
                : 'No se pudo descargar el archivo. Revisa la conexión e intenta de nuevo.'
            }
          />
        ) : null}
      </section>
    </RequireRole>
  );
}
