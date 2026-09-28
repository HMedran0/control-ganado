import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Ruta corta del QR del sistema (IDN-03): `${PUBLIC_WEB_URL}/a/<id>`. Vive dentro de `_app`, así
 * que sin sesión pide iniciarla y vuelve aquí; con sesión, abre la ficha. La ficha solo se ve si
 * el animal es de la finca de quien escanea (CA3).
 */
export const Route = createFileRoute('/_app/a/$id')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/animals/$id', params: { id: params.id }, replace: true });
  },
});
