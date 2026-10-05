import { zodResolver } from '@hookform/resolvers/zod';
import { voidEventSchema, type VoidEventInput } from '@hato/shared';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { SaveError } from '../reproduction/form-kit';

/**
 * Anular un evento (vacunación, tratamiento, pesaje; RN-11): pide el motivo. El evento deja de
 * contar, pero queda en el historial con su motivo.
 */
export function VoidEventDialog({
  title,
  description,
  animalId,
  error,
  pending,
  onVoid,
  onClose,
}: {
  title: string;
  description: string;
  animalId: string;
  error: unknown;
  pending: boolean;
  onVoid: (body: VoidEventInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(voidEventSchema), defaultValues: { reason: '' } });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) =>
          void handleSubmit(async (body) => {
            try {
              await onVoid(body);
              onClose();
            } catch {
              // El error se muestra abajo.
            }
          })(event)
        }
      >
        <TextAreaField label="Motivo" error={errors.reason?.message} {...register('reason')} />
        <SaveError error={error} damId={animalId} />
        <Button type="submit" block disabled={isSubmitting || pending}>
          {pending ? 'Anulando…' : 'Anular'}
        </Button>
      </form>
    </Dialog>
  );
}
