import { formatDate, updateSaleSchema, type SaleView, type UpdateSaleInput } from '@hato/shared';
import { Controller, useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { NumberField } from '../../components/ui/NumberField';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import { SaveError, schemaResolver } from '../reproduction/form-kit';
import { useUpdateSale } from './api';

type SaleValues = { amount: string | null; buyer: string; notes: string };

/**
 * Corregir una venta (ECO-04, M7), solo ADMIN: precio, comprador y observaciones. La fecha es la
 * de la salida; para cambiarla, se revierte la salida y se registra de nuevo. Queda en los cambios
 * del animal con el antes y el después.
 */
export function SaleDialog({ sale, onClose }: { sale: SaleView; onClose: () => void }) {
  const update = useUpdateSale();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SaleValues, unknown, UpdateSaleInput>({
    resolver: schemaResolver(updateSaleSchema, (values) => ({
      version: sale.version,
      amount: values.amount ?? '',
      buyer: values.buyer.trim() === '' ? null : values.buyer,
      notes: values.notes.trim() === '' ? null : values.notes,
    })),
    defaultValues: {
      amount: String(Number(sale.amount)),
      buyer: sale.buyer ?? '',
      notes: sale.notes ?? '',
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Corregir la venta de ${sale.animal.code}`}
      description={`Vendido el ${formatDate(sale.date)}. La fecha es la de la salida: para cambiarla, revierte la salida.`}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async (body) => {
            try {
              await update.mutateAsync({ id: sale.id, body });
              onClose();
            } catch {
              // El error se muestra abajo.
            }
          })(event)
        }
      >
        <Controller
          control={control}
          name="amount"
          render={({ field }) => (
            <NumberField
              label="Precio de venta"
              currency
              value={field.value}
              onChange={field.onChange}
              error={errors.amount?.message}
            />
          )}
        />
        <TextField label="Comprador" hint="Opcional." {...register('buyer')} />
        <TextAreaField label="Observaciones" hint="Opcional." {...register('notes')} />
        <SaveError error={update.error} damId={sale.animal.id} />
        <Button type="submit" block disabled={isSubmitting || update.isPending}>
          {update.isPending ? 'Guardando…' : 'Guardar corrección'}
        </Button>
      </form>
    </Dialog>
  );
}
