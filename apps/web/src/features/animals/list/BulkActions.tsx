import type { IsoDate, LotView, TagView } from '@hato/shared';
import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { DateQuickPick } from '../../../components/ui/DateQuickPick';
import { Dialog } from '../../../components/ui/Dialog';
import { FormError } from '../../../components/ui/FormError';
import { SelectField } from '../../../components/ui/SelectField';
import { isApiError } from '../../../lib/api/errors';
import { useToday } from '../../../lib/clock';
import { useBulkLot, useBulkTags } from '../api';
import { animalsCount } from '../labels';

type Mode = 'addTag' | 'removeTag' | 'lot' | 'forSale' | 'notForSale';

const TITLES: Record<Mode, string> = {
  addTag: 'Agregar etiqueta',
  removeTag: 'Quitar etiqueta',
  lot: 'Cambiar de lote',
  forSale: 'Marcar disponibles para venta',
  notForSale: 'Quitar de disponibles para venta',
};

/**
 * Operaciones en lote sobre los animales seleccionados (CLS-02 CA2): etiquetas manuales, lote
 * y, solo para ADMIN, «Disponible para venta» (CLS-02 CA1). La API aplica todo o nada: si un
 * animal ya salió de la finca, no se cambia ninguno y el mensaje dice cuál.
 */
export function BulkActions({
  selectedIds,
  isAdmin,
  tags,
  lots,
  onDone,
  onClear,
}: {
  selectedIds: readonly string[];
  isAdmin: boolean;
  /** Etiquetas manuales activas. */
  tags: readonly TagView[];
  /** Lotes activos. */
  lots: readonly LotView[];
  /** Mensaje de lo que se hizo, para anunciarlo. */
  onDone: (message: string) => void;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const count = selectedIds.length;
  if (count === 0) return null;

  const button = (next: Mode) => (
    <Button
      variant="secondary"
      onClick={() => {
        setMode(next);
      }}
    >
      {TITLES[next]}
    </Button>
  );

  return (
    <section
      aria-label="Acciones con los animales seleccionados"
      className="sticky bottom-24 z-10 flex flex-col gap-2 rounded-panel border-2 border-potrero bg-superficie p-3 shadow-lg lg:bottom-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          {count === 1 ? '1 animal seleccionado' : `${count} animales seleccionados`}
        </p>
        <Button variant="ghost" onClick={onClear}>
          Quitar la selección
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? null : button('addTag')}
        {tags.length === 0 ? null : button('removeTag')}
        {button('lot')}
        {isAdmin ? button('forSale') : null}
        {isAdmin ? button('notForSale') : null}
      </div>
      {mode === null ? null : (
        <BulkDialog
          mode={mode}
          selectedIds={selectedIds}
          tags={tags}
          lots={lots}
          onClose={() => {
            setMode(null);
          }}
          onDone={(message) => {
            setMode(null);
            onDone(message);
          }}
        />
      )}
    </section>
  );
}

function BulkDialog({
  mode,
  selectedIds,
  tags,
  lots,
  onClose,
  onDone,
}: {
  mode: Mode;
  selectedIds: readonly string[];
  tags: readonly TagView[];
  lots: readonly LotView[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const today = useToday();
  const bulkTags = useBulkTags();
  const bulkLot = useBulkLot();
  const [tagId, setTagId] = useState(tags[0]?.id ?? '');
  const [lotId, setLotId] = useState(lots[0]?.id ?? '');
  const [date, setDate] = useState<IsoDate>(today);
  const [error, setError] = useState<string | null>(null);
  const animalIds = [...selectedIds];
  const who = animalsCount(animalIds.length);
  const pending = bulkTags.isPending || bulkLot.isPending;

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      if (mode === 'lot') {
        const result = await bulkLot.mutateAsync({
          animalIds,
          lotId: lotId === '' ? null : lotId,
          date,
        });
        const lot = lots.find((item) => item.id === lotId)?.name;
        onDone(
          `${animalsCount(result.moved)} ${lot === undefined ? 'sin lote' : `al lote ${lot}`}` +
            (result.unchanged === 0 ? '.' : `; ${animalsCount(result.unchanged)} ya estaban ahí.`),
        );
        return;
      }
      if (mode === 'forSale' || mode === 'notForSale') {
        await bulkTags.mutateAsync({ animalIds, forSale: mode === 'forSale' });
        onDone(
          mode === 'forSale'
            ? `${who} marcados como disponibles para venta.`
            : `${who} ya no están disponibles para venta.`,
        );
        return;
      }
      const label = tags.find((tag) => tag.id === tagId)?.label ?? 'La etiqueta';
      await bulkTags.mutateAsync(
        mode === 'addTag' ? { animalIds, add: [tagId] } : { animalIds, remove: [tagId] },
      );
      onDone(
        mode === 'addTag'
          ? `Etiqueta ${label} agregada a ${who}.`
          : `Etiqueta ${label} quitada a ${who}.`,
      );
    } catch (caught) {
      setError(isApiError(caught) ? caught.detail : 'Ocurrió un error inesperado.');
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={TITLES[mode]}
      description={`Se aplica a ${who}.`}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === 'addTag' || mode === 'removeTag' ? (
          <SelectField
            label="Etiqueta"
            value={tagId}
            onChange={(event) => {
              setTagId(event.target.value);
            }}
          >
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.label}
              </option>
            ))}
          </SelectField>
        ) : null}
        {mode === 'lot' ? (
          <>
            <SelectField
              label="Lote nuevo"
              value={lotId}
              onChange={(event) => {
                setLotId(event.target.value);
              }}
            >
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.name}
                </option>
              ))}
              <option value="">Sin lote</option>
            </SelectField>
            <DateQuickPick label="Fecha del cambio" value={date} onChange={setDate} today={today} />
          </>
        ) : null}
        <FormError message={error} />
        <Button type="submit" block disabled={pending}>
          {pending ? 'Guardando…' : TITLES[mode]}
        </Button>
      </form>
    </Dialog>
  );
}
