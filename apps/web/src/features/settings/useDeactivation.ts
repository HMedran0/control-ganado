import type { Warning } from '@hato/shared';
import { useState } from 'react';

import { useUndoToast } from '../../components/ui/UndoToast';
import { useAuth } from '../../lib/auth/context';
import {
  fetchDeactivationWarnings,
  useCatalogMutations,
  type CatalogItem,
  type CatalogKey,
} from './api';

type Item = { readonly id: string; readonly version: number };

/**
 * Desactivar y reactivar elementos de un catálogo.
 *
 * - Sin advertencias: se desactiva de inmediato y aparece «Lote desactivado · Deshacer»
 *   (06 §2.4: deshacer en vez de confirmar).
 * - Con advertencias (un lote con animales activos, una vacuna de un ciclo en curso o futuro):
 *   primero se muestran y se pide confirmar. No se bloquea; la persona decide.
 */
export function useDeactivation<K extends CatalogKey>(catalog: K, deactivatedMessage: string) {
  const { api } = useAuth();
  const { update } = useCatalogMutations(catalog);
  const showUndo = useUndoToast();
  const [pending, setPending] = useState<{
    item: CatalogItem[K];
    warnings: readonly Warning[];
  } | null>(null);

  const deactivateNow = async (item: Item): Promise<void> => {
    const saved = await update.mutateAsync({
      id: item.id,
      body: { version: item.version, isActive: false },
    });
    setPending(null);
    showUndo({
      message: deactivatedMessage,
      onUndo: () => {
        update.mutate({ id: item.id, body: { version: saved.version, isActive: true } });
      },
    });
  };

  const request = async (item: CatalogItem[K]): Promise<void> => {
    if (catalog === 'lots' || catalog === 'vaccines') {
      const { warnings } = await fetchDeactivationWarnings(api, catalog, item.id);
      if (warnings.length > 0) {
        setPending({ item, warnings });
        return;
      }
    }
    await deactivateNow(item);
  };

  const activate = async (item: Item): Promise<void> => {
    await update.mutateAsync({ id: item.id, body: { version: item.version, isActive: true } });
  };

  return {
    /** Elemento con advertencias esperando confirmación. */
    pending,
    request,
    confirm: async () => {
      if (pending !== null) await deactivateNow(pending.item);
    },
    cancel: () => {
      setPending(null);
    },
    activate,
    error: update.error,
    isPending: update.isPending,
  };
}
