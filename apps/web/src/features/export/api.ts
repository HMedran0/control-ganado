import { useMutation } from '@tanstack/react-query';

import { useAuth } from '../../lib/auth/context';
import { saveFile } from '../../lib/files/save-file';

/**
 * Exportación completa de la finca (BAK-02, solo ADMIN): un ZIP con un Excel por tipo de registro
 * y un LEEME. La API lo genera mientras se descarga; aquí se guarda cuando termina.
 */
export function useFullExport() {
  const { api } = useAuth();
  return useMutation({
    mutationFn: async () => {
      saveFile(await api.download('/export/full'));
    },
  });
}
