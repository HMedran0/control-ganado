import { createFileRoute } from '@tanstack/react-router';

import { SearchResultsPage } from '../../features/animals/search/SearchResultsPage';

type SearchPageSearch = { q: string };

/** Resultados de la búsqueda cuando no hay una coincidencia exacta única (ANI-05). */
export const Route = createFileRoute('/_app/search')({
  validateSearch: (search: Record<string, unknown>): SearchPageSearch => {
    const q = typeof search.q === 'number' ? String(search.q) : search.q;
    return { q: typeof q === 'string' ? q.slice(0, 100) : '' };
  },
  component: SearchRoute,
});

function SearchRoute() {
  const { q } = Route.useSearch();
  return <SearchResultsPage key={q} q={q} />;
}
