# ADR-008 — La web y la API se sirven desde el mismo origen

- **Fecha:** 2026-09-27
- **Estado:** Aceptada
- **Hito:** M2a
- **Afecta:** `apps/web/vite.config.ts`, `apps/web/playwright.config.ts`, `.env.example`,
  despliegue de M10 (`docker-compose.prod.yml`, Caddy)

## Contexto

La sesión de la web (ADR-007) usa dos tokens:

- el de **acceso**, que la página guarda solo en memoria y envía en `Authorization`;
- el de **refresco**, que viaja en una cookie
  `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.

Con la web y la API en orígenes distintos (por ejemplo `localhost:5173` y `localhost:3000`),
esa cookie obliga a CORS con credenciales, y `SameSite=Strict` la bloquea en cuanto los dos
orígenes dejan de ser el mismo sitio (dominios distintos en producción). Relajarla a
`SameSite=None` la expondría a peticiones de otros sitios, justo lo que `Strict` evita.

Además, el refresco se hace al abrir la aplicación: si la cookie no viaja, cada recarga
manda a la persona al inicio de sesión.

## Decisión

**La página y la API comparten origen en todos los entornos.** El navegador solo habla con
un origen; `/api` se reenvía a la API.

| Entorno                      | Quién sirve la página                      | Quién reenvía `/api`                                                         |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| Desarrollo (`pnpm dev`)      | Vite en `http://localhost:5173`            | Proxy de Vite hacia `API_PROXY_TARGET` (`http://localhost:3000` por defecto) |
| Pruebas de extremo a extremo | `vite preview` en `http://localhost:4173`  | El mismo proxy, en `preview.proxy`                                           |
| Producción (M10)             | Caddy, con los archivos de `apps/web/dist` | Caddy, `reverse_proxy` hacia el contenedor de la API                         |

Configuración de Caddy prevista para M10 (un solo dominio, HTTPS automático):

```caddyfile
hato.example.co {
    encode zstd gzip

    # La API: mismo dominio, sin CORS.
    handle /api/* {
        reverse_proxy api:3000
    }

    # La web: archivos estáticos y, para las rutas del cliente, index.html.
    handle {
        root * /srv/web
        try_files {path} /index.html
        file_server
    }
}
```

`API_PROXY_TARGET` no lleva el prefijo `VITE_` a propósito: es configuración del servidor de
desarrollo y no debe terminar dentro del paquete que se descarga el navegador.

## Consecuencias

- La cookie de refresco funciona con `SameSite=Strict` y sin CORS. `CORS_ORIGINS` se queda
  en la API, restringido, pero la web no lo necesita.
- Las pruebas de extremo a extremo reproducen el camino de producción: la página compilada,
  el reenvío de `/api` y la cookie real.
- **`Secure` en `http://localhost`:** Chromium y Firefox tratan `localhost` como contexto
  seguro y aceptan la cookie. WebKit no lo garantiza, por eso Playwright corre solo con
  Chromium. En producción siempre hay HTTPS.
- **IP real detrás de Caddy (pendiente para M10):** con un proxy delante, la API ve la IP de
  Caddy. El límite de peticiones por IP (ADR-007) necesita activar `trustProxy` en Fastify,
  limitado a la red interna de Docker, para leer `X-Forwarded-For` sin que un cliente pueda
  falsificarlo. En desarrollo todas las peticiones llegan desde `127.0.0.1`, lo que no
  cambia nada.
- **Varias pestañas:** como la cookie es una sola por origen y la API revoca toda la familia
  si recibe un refresco ya rotado, la web serializa los refrescos entre pestañas con Web Locks
  (`apps/web/src/lib/api/client.ts`).
- **Escritorio (F3, Tauri):** la aplicación empaquetada tendrá su propio origen
  (`tauri://localhost`) y no podrá compartirlo con la API. Hará falta una decisión propia
  (probablemente el token de refresco en el almacén seguro del sistema, como en el móvil).

## Alternativas descartadas

| Alternativa                                          | Por qué no                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Orígenes distintos con CORS y `credentials: include` | Obliga a `SameSite=None` en cuanto los dominios difieren, y cada petición autenticada paga una consulta previa (`OPTIONS`). |
| Subdominio para la API (`api.hato.example.co`)       | Mismo sitio pero distinto origen: sigue necesitando CORS con credenciales y un segundo certificado, sin ganar nada.         |
| Token de refresco en `localStorage`                  | Lo leería cualquier XSS; es exactamente lo que ADR-007 evita con la cookie `HttpOnly`.                                      |
