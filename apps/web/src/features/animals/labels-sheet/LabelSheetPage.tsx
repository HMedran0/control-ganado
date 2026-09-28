import type { AnimalLabels, AnimalLabelView } from '@hato/shared';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import { Button } from '../../../components/ui/Button';
import { Chapeta } from '../../../components/ui/Chapeta';
import { EmptyState } from '../../../components/ui/EmptyState';
import { FormError } from '../../../components/ui/FormError';
import { QrCode } from '../../../components/ui/QrCode';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { isApiError } from '../../../lib/api/errors';
import { useAuth } from '../../../lib/auth/context';
import {
  FORMATS,
  MARGIN_MM,
  PAPERS,
  paginate,
  sheetLayout,
  sheetSummary,
  type LabelFormat,
  type Paper,
  type SheetLayout,
} from './layout';

/** Qué etiquetas: una selección (`ids`) o lo que muestra el listado con sus filtros (`query`). */
export type LabelSource = { readonly ids?: string; readonly query?: string };

/**
 * Hoja de etiquetas para imprimir desde el navegador (IDN-03 CA2, solo ADMIN): código grande con
 * la tipografía de la Chapeta, QR con la URL de la ficha e identificadores principales. Tamaño
 * carta o A4 con `@page`; no se genera PDF (M19).
 *
 * En pantalla se ven las hojas como vista previa; al imprimir, solo las hojas (el resto de la
 * aplicación lleva `print:hidden`).
 */
export function LabelSheetPage({
  source,
  paper,
  format,
  onChange,
}: {
  source: LabelSource;
  paper: Paper;
  format: LabelFormat;
  onChange: (next: { paper?: Paper; format?: LabelFormat }) => void;
}) {
  const { api } = useAuth();
  const search =
    source.ids !== undefined && source.ids !== '' ? `ids=${source.ids}` : (source.query ?? '');
  const labels = useQuery({
    queryKey: ['animals', 'labels', search],
    queryFn: () => api.get<AnimalLabels>(`/animals/labels?${search}`),
  });
  const layout = sheetLayout(paper, format);
  const items = labels.data?.items ?? [];
  const pages = paginate(items, layout.perPage);

  return (
    <div className="flex flex-col gap-5">
      {/* El tamaño de la hoja lo decide la vista previa elegida. */}
      <style>{`@page { size: ${PAPERS[paper].css}; margin: ${MARGIN_MM}mm; }`}</style>

      <div className="flex flex-col gap-4 print:hidden">
        <div className="grid gap-4 sm:grid-cols-2">
          <SegmentedChoice<Paper>
            label="Papel"
            options={(['letter', 'a4'] as const).map((value) => ({
              value,
              label: PAPERS[value].label,
            }))}
            value={paper}
            onChange={(value) => {
              onChange({ paper: value });
            }}
          />
          <SegmentedChoice<LabelFormat>
            label="Formato"
            options={(['card', 'label'] as const).map((value) => ({
              value,
              label: FORMATS[value].label,
            }))}
            value={format}
            onChange={(value) => {
              onChange({ format: value });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={items.length === 0}
            onClick={() => {
              window.print();
            }}
          >
            <Printer aria-hidden="true" className="size-5" />
            Imprimir
          </Button>
          <p role="status" className="font-bold">
            {labels.isPending ? 'Cargando…' : sheetSummary(items.length, pages.length)}
          </p>
        </div>
        {labels.data?.truncated === true ? (
          <p className="text-texto-2">
            Son muchos animales: la hoja trae los primeros {items.length.toLocaleString('es-CO')}.
            Filtra el listado para imprimir el resto.
          </p>
        ) : null}
        <p className="text-texto-2">
          En el diálogo de impresión deja la escala en 100 % y sin encabezados ni pies de página.
        </p>
        <FormError
          message={
            labels.error === null
              ? null
              : isApiError(labels.error)
                ? labels.error.detail
                : 'No pudimos cargar las etiquetas.'
          }
        />
      </div>

      {labels.isSuccess && items.length === 0 ? (
        <EmptyState
          icon={Printer}
          title="No hay animales para las etiquetas"
          description="Vuelve al listado y elige animales o cambia los filtros."
        />
      ) : null}

      {/* En el celular la hoja es más ancha que la pantalla: la vista previa se desplaza de lado y,
          para poder hacerlo con teclado, es una región enfocable (axe: scrollable-region-focusable). */}
      <div
        role="region"
        aria-label="Vista previa de las hojas"
        tabIndex={0}
        className="overflow-x-auto print:overflow-visible"
      >
        <div className="flex flex-col gap-6 print:gap-0" aria-label="Hojas de etiquetas">
          {pages.map((page, index) => (
            <Sheet key={index} labels={page} layout={layout} format={format} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Sheet({
  labels,
  layout,
  format,
}: {
  labels: readonly AnimalLabelView[];
  layout: SheetLayout;
  format: LabelFormat;
}) {
  return (
    <div
      className="mx-auto shrink-0 bg-white text-black shadow-md ring-1 ring-cerca print:mx-0 print:break-after-page print:shadow-none print:ring-0"
      style={{
        width: `${layout.widthMm}mm`,
        height: `${layout.heightMm}mm`,
        display: 'grid',
        gridTemplateColumns: `repeat(${layout.columns}, 1fr)`,
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
      }}
    >
      {labels.map((label) => (
        <LabelCell key={label.id} label={label} format={format} layout={layout} />
      ))}
    </div>
  );
}

function LabelCell({
  label,
  format,
  layout,
}: {
  label: AnimalLabelView;
  format: LabelFormat;
  layout: SheetLayout;
}) {
  const card = format === 'card';
  const qrMm = Math.min(layout.cellHeightMm - 6, layout.cellWidthMm / 2 - 4);
  const ids = [
    label.visualTag === null ? null : `Chapeta ${label.visualTag}`,
    label.din === null ? null : `DIN ${label.din}`,
    label.rfid === null ? null : `Chip ${label.rfid.slice(0, 3)} ${label.rfid.slice(3)}`,
  ].filter((text) => text !== null);

  return (
    <article
      aria-label={`Etiqueta de ${label.code}`}
      className="flex items-center justify-between gap-2 overflow-hidden border border-dashed border-cerca p-[3mm] print:border-black/30"
    >
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Chapeta code={label.code} size={card ? 'l' : 'm'} />
        {label.name === null ? null : (
          <p className={`max-w-full truncate font-bold ${card ? 'text-base' : 'text-[9pt]'}`}>
            {label.name}
          </p>
        )}
        {ids.map((text) => (
          <p key={text} className={`max-w-full truncate ${card ? 'text-[10pt]' : 'text-[7pt]'}`}>
            {text}
          </p>
        ))}
      </div>
      <QrCode
        value={label.qrUrl}
        label={`QR de la ficha de ${label.code}`}
        className="shrink-0"
        style={{ width: `${qrMm}mm`, height: `${qrMm}mm` }}
      />
    </article>
  );
}
