import type { DownloadedFile } from '../api/client';

/**
 * Entrega al navegador un archivo que llegó de la API (exportación, plantilla, filas con error):
 * crea un enlace temporal y lo pulsa. Así la descarga lleva la sesión, que un enlace directo a la
 * API no tendría (el token vive en memoria, ADR-008).
 */
export function saveFile(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Se libera después: algunos navegadores leen el blob cuando la descarga ya empezó.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}
