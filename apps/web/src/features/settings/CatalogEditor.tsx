import type { Warning } from '@hato/shared';
import { SearchX } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AlertBanner } from '../../components/ui/AlertBanner';
import { EmptyState } from '../../components/ui/EmptyState';
import { useCatalogItem, type CatalogItem, type CatalogKey, type Saved } from './api';
import { SettingsHeader } from './SettingsHeader';

export type EditorFormProps<T> = {
  readonly item?: T;
  readonly onSaved: (saved: Saved<T>) => void;
  readonly onReload: () => void;
};

/**
 * Pantalla de crear o editar un elemento de catálogo.
 *
 * - Al guardar sin advertencias, vuelve al listado.
 * - Con advertencias (un ciclo que se cruza con otro), se queda y las muestra: ya se guardó,
 *   pero la persona debe enterarse antes de seguir.
 * - Tras un conflicto de versión, «Recargar» trae la versión actual y reinicia el formulario.
 */
export function CatalogEditor<K extends CatalogKey>({
  catalog,
  id,
  title,
  notFound,
  backLink,
  onDone,
  form,
}: {
  catalog: K;
  /** `undefined` al crear. */
  id?: string;
  title: string;
  notFound: string;
  /** Enlace de vuelta al listado (con la ruta tipada). */
  backLink: ReactNode;
  onDone: () => void;
  form: (props: EditorFormProps<CatalogItem[K]>) => ReactNode;
}) {
  const query = useCatalogItem(catalog, id ?? '');
  const [warnings, setWarnings] = useState<readonly Warning[]>([]);
  const [reloads, setReloads] = useState(0);

  const onSaved = (saved: Saved<CatalogItem[K]>): void => {
    if (saved.warnings !== undefined && saved.warnings.length > 0) {
      setWarnings(saved.warnings);
      return;
    }
    onDone();
  };
  const onReload = (): void => {
    void query.refetch().then(() => {
      setReloads((count) => count + 1);
    });
  };

  if (warnings.length > 0) {
    return (
      <>
        <SettingsHeader title={title} />
        <div className="flex max-w-xl flex-col gap-4">
          {warnings.map((warning) => (
            <AlertBanner
              key={warning.code + warning.message}
              tone="aviso"
              title="Guardado, con una advertencia"
              description={warning.message}
            />
          ))}
          {backLink}
        </div>
      </>
    );
  }

  if (id !== undefined && query.isPending) {
    return (
      <>
        <SettingsHeader title={title} />
        <p role="status" className="text-texto-2">
          Cargando…
        </p>
      </>
    );
  }

  if (id !== undefined && query.item === undefined) {
    return (
      <>
        <SettingsHeader title={title} />
        <EmptyState
          icon={SearchX}
          title={notFound}
          description="Puede que el enlace esté incompleto o que sea de otra finca."
        />
      </>
    );
  }

  return (
    <>
      <SettingsHeader title={title} />
      <div key={reloads}>{form({ item: query.item, onSaved, onReload })}</div>
    </>
  );
}
