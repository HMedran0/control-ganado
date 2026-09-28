import type { AnimalImportPreview, AnimalImportResultView } from '@hato/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../lib/auth/context';
import { saveFile } from '../../lib/files/save-file';
import { animalKeys } from '../animals/api';

/** Archivo elegido y opciones de la simulación (ANI-09). */
export type ImportRequest = {
  readonly file: File;
  readonly createMissingBreeds: boolean;
  /** Filas desmarcadas por la persona. */
  readonly skipRows: readonly number[];
};

function formOf(request: ImportRequest, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  // Los campos van antes que el archivo: así la API los tiene al leer el archivo.
  form.append('createMissingBreeds', String(request.createMissingBreeds));
  form.append('skipRows', request.skipRows.join(','));
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  form.append('file', request.file, request.file.name);
  return form;
}

export function useImportMutations() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return {
    preview: useMutation({
      mutationFn: (request: ImportRequest) =>
        api.post<AnimalImportPreview>('/imports/animals?dryRun=true', formOf(request)),
    }),
    confirm: useMutation({
      mutationFn: ({
        request,
        importKey,
        expectedRows,
      }: {
        request: ImportRequest;
        importKey: string;
        expectedRows: number;
      }) =>
        api.post<AnimalImportResultView>(
          '/imports/animals',
          formOf(request, { importKey, expectedRows: String(expectedRows) }),
        ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: animalKeys.lists }),
    }),
    template: useMutation({
      mutationFn: async () => {
        saveFile(await api.download('/imports/animals/template'));
      },
    }),
    errors: useMutation({
      mutationFn: async (request: ImportRequest) => {
        saveFile(await api.download('/imports/animals/errors', formOf(request)));
      },
    }),
  };
}
