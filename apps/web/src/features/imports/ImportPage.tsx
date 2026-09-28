import { formatDate, isoDateFromInstant, uuidv7, type AnimalImportPreview } from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { CircleCheck, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent } from 'react';

import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { FormError } from '../../components/ui/FormError';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { isApiError } from '../../lib/api/errors';
import { FARM_TIME_ZONE } from '../../lib/clock';
import { useImportMutations, type ImportRequest } from './api';
import { filterRows, groupIssues, importButtonText, resultText, type IssueFilter } from './issues';

/** Filas de problemas que se pintan de una vez; el resto, con «Mostrar más». */
const PAGE = 100;

const errorText = (error: unknown): string =>
  isApiError(error) ? error.detail : 'Ocurrió un error inesperado.';

/**
 * Importar inventario (ANI-09, 06 §5.6): plantilla, archivo, simulación y confirmación.
 *
 * La simulación se vuelve a pedir al elegir el archivo, al marcar «Crear las razas que no
 * existen» y al desmarcar filas, así el número del botón es exactamente el que se importa. La
 * clave de idempotencia se genera al elegir el archivo (ADR-011): un doble clic o un reintento
 * con la misma clave no importa dos veces.
 */
export function ImportPage() {
  const { preview, confirm, template, errors } = useImportMutations();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [createBreeds, setCreateBreeds] = useState(false);
  const [importKey, setImportKey] = useState<string>(() => uuidv7());
  const [filter, setFilter] = useState<IssueFilter>('all');
  const [shown, setShown] = useState(PAGE);

  const simulate = (next: ImportRequest): void => {
    setRequest(next);
    setShown(PAGE);
    confirm.reset();
    preview.mutate(next);
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setImportKey(uuidv7());
    setFilter('all');
    simulate({ file, createMissingBreeds: createBreeds, skipRows: [] });
  };

  const reset = (): void => {
    setRequest(null);
    preview.reset();
    confirm.reset();
    if (input.current !== null) input.current.value = '';
  };

  const result = preview.data;
  const done = confirm.data;

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <section aria-labelledby="paso-plantilla" className="flex flex-col gap-3">
        <h2 id="paso-plantilla" className="text-lg font-bold">
          1. Descarga la plantilla
        </h2>
        <p className="text-texto-2">
          Trae las razas y los lotes de tu finca en listas desplegables. Llena una fila por animal;
          las columnas con * son obligatorias.
        </p>
        <Button
          variant="secondary"
          className="self-start"
          disabled={template.isPending}
          onClick={() => {
            template.mutate();
          }}
        >
          <Download aria-hidden="true" className="size-5" />
          {template.isPending ? 'Descargando…' : 'Descargar la plantilla'}
        </Button>
        <FormError message={template.error === null ? null : errorText(template.error)} />
      </section>

      <section aria-labelledby="paso-archivo" className="flex flex-col gap-4">
        <h2 id="paso-archivo" className="text-lg font-bold">
          2. Sube tu archivo
        </h2>
        <p className="text-texto-2">
          Primero revisamos el archivo sin guardar nada. Puedes importar varias veces: los códigos
          que ya existen quedan como error y no se tocan.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="font-bold">
            Archivo (.xlsx o .csv, hasta 5 MB)
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="min-h-touch rounded-control border-2 border-cerca bg-superficie p-2 file:mr-3 file:min-h-touch file:rounded-control file:border-0 file:bg-potrero-claro file:px-4 file:font-bold file:text-monte"
            onChange={onFile}
          />
        </div>
        <Checkbox
          label="Crear las razas que no existen"
          description="Se crean en el grupo Cruce; después puedes ajustarlas en Configuración → Razas."
          checked={createBreeds}
          onChange={(event) => {
            setCreateBreeds(event.target.checked);
            if (request !== null) {
              simulate({ ...request, createMissingBreeds: event.target.checked });
            }
          }}
          disabled={preview.isPending}
        />
      </section>

      <div role="status" aria-live="polite">
        {preview.isPending ? <p className="text-texto-2">Revisando el archivo…</p> : null}
      </div>
      <FormError message={preview.error === null ? null : errorText(preview.error)} />

      {result !== undefined && request !== null && done === undefined ? (
        <Simulation
          result={result}
          request={request}
          filter={filter}
          shown={shown}
          onFilter={setFilter}
          onMore={() => {
            setShown((value) => value + PAGE);
          }}
          onToggleRow={(row, include) => {
            const skip = new Set(request.skipRows);
            if (include) skip.delete(row);
            else skip.add(row);
            simulate({ ...request, skipRows: [...skip].sort((a, b) => a - b) });
          }}
          confirming={confirm.isPending}
          confirmError={confirm.error === null ? null : errorText(confirm.error)}
          onConfirm={() => {
            confirm.mutate({ request, importKey, expectedRows: result.importable });
          }}
          downloadingErrors={errors.isPending}
          onDownloadErrors={() => {
            errors.mutate(request);
          }}
          onReset={reset}
        />
      ) : null}

      {done !== undefined ? (
        <section aria-labelledby="paso-listo" className="flex flex-col items-start gap-4">
          <h2 id="paso-listo" className="sr-only">
            Resultado
          </h2>
          <p role="status" className="flex items-center gap-2 text-lg font-bold text-potrero">
            <CircleCheck aria-hidden="true" className="size-6" />
            {resultText(done.created, done.skipped)}
          </p>
          {done.replayed ? (
            <p className="text-texto-2">Esta importación ya se había hecho; no se repitió.</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Link
              to="/animals"
              className="inline-flex min-h-touch-primary items-center gap-2 rounded-control bg-potrero px-5 font-bold text-white hover:bg-monte"
            >
              Ver los animales
            </Link>
            <Button variant="secondary" onClick={reset}>
              <Upload aria-hidden="true" className="size-5" />
              Importar otro archivo
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Simulation({
  result,
  request,
  filter,
  shown,
  onFilter,
  onMore,
  onToggleRow,
  confirming,
  confirmError,
  onConfirm,
  downloadingErrors,
  onDownloadErrors,
  onReset,
}: {
  result: AnimalImportPreview;
  request: ImportRequest;
  filter: IssueFilter;
  shown: number;
  onFilter: (filter: IssueFilter) => void;
  onMore: () => void;
  onToggleRow: (row: number, include: boolean) => void;
  confirming: boolean;
  confirmError: string | null;
  onConfirm: () => void;
  downloadingErrors: boolean;
  onDownloadErrors: () => void;
  onReset: () => void;
}) {
  const grouped = groupIssues(result.issues);
  const skipped = request.skipRows;
  const visible = filterRows(grouped, filter);
  const errorCount = grouped.filter((row) => row.severity === 'error').length;
  const warningCount = grouped.length - errorCount;

  return (
    <section aria-labelledby="paso-simulacion" className="flex flex-col gap-5">
      <h2 id="paso-simulacion" className="text-lg font-bold">
        3. Revisa la simulación de {result.fileName}
      </h2>

      {result.previousImport === null ? null : (
        <AlertBanner
          tone="aviso"
          title={`Este archivo ya se importó el ${formatDate(isoDateFromInstant(new Date(result.previousImport.importedAt), FARM_TIME_ZONE))} (${result.previousImport.createdRows.toLocaleString('es-CO')} animales).`}
          description="Si lo importas otra vez, los códigos que ya existen quedan como error y no se duplican."
        />
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Counter label="Listas para importar" value={result.validRows} tone="potrero" />
        <Counter label="Con advertencias" value={result.warningRows} tone="aviso" />
        <Counter label="Con errores" value={result.errorRows} tone="alerta" />
      </dl>
      {skipped.length > 0 ? (
        <p className="text-texto-2">
          Desmarcaste {skipped.length === 1 ? 'la fila' : 'las filas'} {skipped.join(', ')}.
        </p>
      ) : null}
      {result.newBreeds.length > 0 ? (
        <p className="text-texto-2">Razas nuevas: {result.newBreeds.join(', ')}.</p>
      ) : null}

      {grouped.length === 0 ? (
        <p className="flex items-center gap-2 font-bold text-potrero">
          <CircleCheck aria-hidden="true" className="size-5" />
          Todas las filas están bien.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <SegmentedChoice<IssueFilter>
            label="Mostrar"
            options={[
              { value: 'all', label: `Todas (${grouped.length})` },
              { value: 'error', label: `Errores (${errorCount})` },
              { value: 'warning', label: `Advertencias (${warningCount})` },
            ]}
            value={filter}
            onChange={onFilter}
          />
          <ul aria-label="Filas con problemas" className="flex flex-col gap-2">
            {visible.slice(0, shown).map((row) => (
              <li
                key={row.row}
                className={`flex flex-col gap-2 rounded-panel border-2 bg-superficie p-3 ${row.severity === 'error' ? 'border-alerta' : 'border-aviso'}`}
              >
                <p className="font-bold">
                  Fila {row.row} ·{' '}
                  <span
                    className={
                      row.severity === 'error' ? 'text-alerta-intenso' : 'text-aviso-intenso'
                    }
                  >
                    {row.severity === 'error' ? 'Error: no se importa' : 'Advertencia'}
                  </span>
                </p>
                <ul className="list-disc pl-5">
                  {row.messages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
                {row.severity === 'warning' ? (
                  <Checkbox
                    label={`Importar la fila ${row.row}`}
                    checked
                    onChange={(event) => {
                      onToggleRow(row.row, event.target.checked);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {skipped.map((row) => (
            <Checkbox
              key={row}
              label={`Importar la fila ${row}`}
              checked={false}
              onChange={(event) => {
                onToggleRow(row, event.target.checked);
              }}
            />
          ))}
          {visible.length > shown ? (
            <Button variant="secondary" className="self-start" onClick={onMore}>
              Mostrar más ({(visible.length - shown).toLocaleString('es-CO')})
            </Button>
          ) : null}
        </div>
      )}

      <FormError message={confirmError} />
      <div className="flex flex-wrap gap-3">
        <Button disabled={result.importable === 0 || confirming} onClick={onConfirm}>
          <FileSpreadsheet aria-hidden="true" className="size-5" />
          {confirming ? 'Importando…' : importButtonText(result.importable)}
        </Button>
        {result.errorRows > 0 ? (
          <Button variant="secondary" disabled={downloadingErrors} onClick={onDownloadErrors}>
            <Download aria-hidden="true" className="size-5" />
            Descargar filas con error
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onReset}>
          Elegir otro archivo
        </Button>
      </div>
    </section>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'potrero' | 'aviso' | 'alerta';
}) {
  const color = {
    potrero: 'border-potrero text-potrero',
    aviso: 'border-aviso text-aviso-intenso',
    alerta: 'border-alerta text-alerta-intenso',
  }[tone];
  return (
    <div className={`flex flex-col gap-1 rounded-panel border-2 bg-superficie p-4 ${color}`}>
      <dt className="font-bold text-monte">{label}</dt>
      <dd className="font-cifras text-cifra">{value.toLocaleString('es-CO')}</dd>
    </div>
  );
}
