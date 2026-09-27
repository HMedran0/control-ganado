import { useEffect, type ReactNode } from 'react';

/**
 * Encabezado de página: un solo `h1` y el título de la pestaña, que es lo primero que anuncia
 * un lector de pantalla al cambiar de página.
 */
export function PageHeader({
  title,
  documentTitle = title,
  children,
}: {
  title: string;
  /** Título de la pestaña si difiere del visible. */
  documentTitle?: string;
  children?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${documentTitle} · Hato`;
  }, [documentTitle]);

  return (
    <header className="mb-6">
      <h1 className="text-xl leading-tight font-bold">{title}</h1>
      {children === undefined ? null : <div className="mt-1 text-texto-2">{children}</div>}
    </header>
  );
}
