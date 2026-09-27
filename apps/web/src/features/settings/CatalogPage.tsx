import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { DataTable, type DataColumn } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormError } from '../../components/ui/FormError';
import { Tag } from '../../components/ui/Tag';
import { isApiError } from '../../lib/api/errors';
import { useCatalog, type CatalogItem, type CatalogKey } from './api';
import { SettingsHeader } from './SettingsHeader';
import { useDeactivation } from './useDeactivation';

type Item = { readonly id: string; readonly isActive: boolean; readonly version: number };

export type CatalogPageProps<K extends CatalogKey> = {
  readonly catalog: K;
  readonly title: string;
  readonly description: string;
  /** Columnas propias del catálogo; el estado y las acciones las agrega la página. */
  readonly columns: readonly DataColumn<CatalogItem[K]>[];
  /** Nombre visible de un elemento, para los avisos («Paridas»). */
  readonly nameOf: (item: CatalogItem[K]) => string;
  /** «Lote desactivado». */
  readonly deactivatedMessage: string;
  /** Enlace «Nuevo lote» (la ruta tipada la pone quien usa la página). */
  readonly newLink: ReactNode;
  /** Enlace «Editar» de cada fila. */
  readonly editLink: (item: CatalogItem[K]) => ReactNode;
  /** ¿Se puede desactivar? (la etiqueta de sistema no). */
  readonly canDeactivate?: (item: CatalogItem[K]) => boolean;
  readonly empty: { icon: LucideIcon; title: string; description: string };
};

/**
 * Listado de un catálogo de Configuración (M3): tabla en escritorio y lista en móvil, con
 * «Mostrar desactivados», editar, desactivar con «Deshacer» y reactivar.
 */
export function CatalogPage<K extends CatalogKey>({
  catalog,
  title,
  description,
  columns,
  nameOf,
  deactivatedMessage,
  newLink,
  editLink,
  canDeactivate = () => true,
  empty,
}: CatalogPageProps<K>) {
  const [showInactive, setShowInactive] = useState(false);
  const list = useCatalog(catalog, showInactive);
  const deactivation = useDeactivation(catalog, deactivatedMessage);
  const rows = list.data?.items ?? [];

  const allColumns: DataColumn<CatalogItem[K]>[] = [
    ...columns.map((column, index) =>
      index === 0
        ? {
            ...column,
            cell: (item: CatalogItem[K]) => (
              <span className="inline-flex flex-wrap items-center gap-2">
                {column.cell(item)}
                {(item as Item).isActive ? null : <Tag tone="neutro">Desactivado</Tag>}
              </span>
            ),
          }
        : column,
    ),
    {
      key: 'acciones',
      header: 'Acciones',
      mobile: 'secondary',
      cell: (item) => (
        <span className="-my-2 flex flex-wrap items-center gap-2">
          {editLink(item)}
          {(item as Item).isActive ? (
            canDeactivate(item) ? (
              <Button
                variant="ghost"
                onClick={() => void deactivation.request(item)}
                aria-label={`Desactivar ${nameOf(item)}`}
              >
                Desactivar
              </Button>
            ) : null
          ) : (
            <Button
              variant="ghost"
              onClick={() => void deactivation.activate(item)}
              aria-label={`Activar ${nameOf(item)}`}
            >
              Activar
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <SettingsHeader title={title}>{description}</SettingsHeader>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {newLink}
        <Checkbox
          label="Mostrar desactivados"
          checked={showInactive}
          onChange={(event) => {
            setShowInactive(event.target.checked);
          }}
        />
      </div>

      {deactivation.pending === null ? null : (
        <div className="mb-4 flex flex-col gap-3">
          {deactivation.pending.warnings.map((warning) => (
            <AlertBanner
              key={warning.code + warning.message}
              tone="aviso"
              title={`Antes de desactivar «${nameOf(deactivation.pending!.item)}»`}
              description={`${warning.message} Si lo desactivas, dejará de ofrecerse en los formularios; lo que ya está registrado no cambia.`}
            />
          ))}
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void deactivation.confirm()} disabled={deactivation.isPending}>
              Desactivar de todos modos
            </Button>
            <Button variant="secondary" onClick={deactivation.cancel}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <FormError
        message={
          deactivation.error === null
            ? null
            : isApiError(deactivation.error)
              ? deactivation.error.detail
              : 'Ocurrió un error inesperado.'
        }
      />

      {list.isPending ? (
        <p role="status" className="text-texto-2">
          Cargando…
        </p>
      ) : list.isError ? (
        <FormError message={isApiError(list.error) ? list.error.detail : 'No se pudo cargar.'} />
      ) : (
        <DataTable
          caption={title}
          columns={allColumns}
          rows={rows}
          rowKey={(item) => item.id}
          empty={
            <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
          }
        />
      )}
    </>
  );
}
