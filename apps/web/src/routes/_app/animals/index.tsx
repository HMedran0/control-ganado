import { createFileRoute } from '@tanstack/react-router';

import {
  filtersFromSearch,
  searchFromFilters,
  validateAnimalListSearch,
} from '../../../features/animals/filters';
import { AnimalListPage } from '../../../features/animals/list/AnimalListPage';

/** Listado de animales (ANI-06). Los filtros viven en la URL (ANI-06 CA1). */
export const Route = createFileRoute('/_app/animals/')({
  validateSearch: validateAnimalListSearch,
  component: AnimalsRoute,
});

function AnimalsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AnimalListPage
      filters={filtersFromSearch(search)}
      onFiltersChange={(filters) => {
        void navigate({ search: searchFromFilters(filters) });
      }}
    />
  );
}
