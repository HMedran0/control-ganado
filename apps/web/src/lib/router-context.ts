import type { QueryClient } from '@tanstack/react-query';

import type { Auth } from './auth/context';

/** Lo que el router pasa a cada ruta (`beforeLoad`, `loader`). */
export type RouterContext = {
  readonly auth: Auth;
  readonly queryClient: QueryClient;
};
