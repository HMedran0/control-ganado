import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * Monta un componente dentro de un router en memoria, para los que usan `Link`.
 * Espera a que el router pinte antes de devolver.
 */
export async function renderWithRouter(ui: ReactElement): Promise<RenderResult> {
  const rootRoute = createRootRoute({
    component: () => <div data-testid="raiz-de-prueba">{ui}</div>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const result = render(<RouterProvider router={router} />);
  await screen.findByTestId('raiz-de-prueba');
  return result;
}
