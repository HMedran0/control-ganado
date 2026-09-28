import { createFileRoute } from '@tanstack/react-router';

import {
  AnimalDetailPage,
  DETAIL_TABS,
  type DetailTab,
} from '../../../../features/animals/detail/AnimalDetailPage';

type DetailSearch = { tab?: DetailTab; anterior?: string };

/** Ficha del animal (ANI-07). La pestaña va en la URL (06 §4). */
export const Route = createFileRoute('/_app/animals/$id/')({
  validateSearch: (search: Record<string, unknown>): DetailSearch => ({
    ...(typeof search.tab === 'string' && (DETAIL_TABS as readonly string[]).includes(search.tab)
      ? { tab: search.tab as DetailTab }
      : {}),
    ...(typeof search.anterior === 'string' && search.anterior !== ''
      ? { anterior: search.anterior }
      : {}),
  }),
  component: AnimalRoute,
});

function AnimalRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AnimalDetailPage
      key={id}
      id={id}
      tab={search.tab}
      previousIdentifier={search.anterior}
      onTabChange={(tab) => {
        void navigate({
          search: (previous) => ({ ...previous, tab: tab === 'resumen' ? undefined : tab }),
          replace: true,
          resetScroll: false,
        });
      }}
    />
  );
}
