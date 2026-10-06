import { useMutation, useQuery } from '@tanstack/react-query';

import { useAuth } from '../../lib/auth/context';
import { saveFile } from '../../lib/files/save-file';

/** Claves de React Query de los reportes (RPT-02, RPT-03). */
export const reportKeys = {
  all: ['reports'] as const,
  one: (path: string) => ['reports', path] as const,
};

/** Un reporte en JSON: `path` incluye la consulta (`/reports/exits?from=…`). */
export function useReport<T>(path: string, enabled = true) {
  const { api } = useAuth();
  return useQuery({
    queryKey: reportKeys.one(path),
    queryFn: () => api.get<T>(path),
    enabled,
  });
}

/** Descarga un reporte en Excel (`GET /reports/:name/export`) con los filtros de la pantalla. */
export function useReportDownload() {
  const { api } = useAuth();
  return useMutation({
    mutationFn: async (path: string) => {
      saveFile(await api.download(path));
    },
  });
}

/** `?from=…&to=…` sin los vacíos. */
export function queryOf(values: Readonly<Record<string, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
