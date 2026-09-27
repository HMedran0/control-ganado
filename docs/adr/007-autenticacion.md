# ADR-007 — Autenticación: tokens, bloqueo, finca activa y retiro de DEV_FAKE_AUTH

- **Fecha:** 2026-09-27
- **Estado:** Aceptada
- **Hito:** M1
- **Afecta:** `apps/api/src/auth/`, `apps/api/src/config/`, `packages/shared/src/schemas/auth.ts`, RN-20, RN-21, RNF-06, RNF-07

## Contexto

M0.3 dejó la API con un mecanismo temporal: con `DEV_FAKE_AUTH=true`, la finca y el rol de
cada petición salían de las cabeceras `x-dev-farm-id` y `x-dev-role`. Servía para construir
`FarmScope`, `RolesGuard` y la auditoría sin tener todavía inicio de sesión, pero **suplanta
la autenticación**: cualquiera que alcanzara la API podía decir de qué finca eran los datos
que pedía. M1 trae AUT-01 a AUT-04 y lo reemplaza.

Este ADR registra las cinco decisiones que no estaban escritas en ningún requisito y que
cambian el comportamiento observable del sistema.

## Decisión 1 — Dos tokens: acceso firmado y refresco opaco

- **Acceso:** JWT HS256 de 15 minutos con el usuario (`sub`), la finca activa y el rol. Se
  verifica fijando `algorithms: ['HS256']` y exigiendo emisor (`hato:api`) y audiencia
  (`hato:clients`). Sin fijar el algoritmo, un token con `alg: none` o firmado con otro
  esquema podría colarse; sin emisor y audiencia, un token de otro sistema que compartiera
  secreto valdría aquí.
- **Refresco:** 32 bytes aleatorios, opacos. En la base solo vive su **hash SHA-256 con
  pimienta**: quien lea la tabla no puede usar las sesiones. Se usa SHA-256 y no Argon2id a
  propósito, porque el valor ya tiene 256 bits de entropía real: no hay diccionario que
  probar y el costo de Argon2 solo haría lento cada refresco.
- La cookie es `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, así que el JavaScript
  de la página no la lee y no viaja en las demás peticiones.
- Rotación en cada refresco. Reutilizar uno ya rotado **revoca toda la familia**: o lo
  robaron, o el cliente reintenta con una copia vieja; en los dos casos lo seguro es cerrar.

El instante sale del `Clock`, no de `Date.now()`, para poder probar vencimientos adelantando
el reloj en vez de esperar quince minutos.

## Decisión 2 — El bloqueo se deduce de los intentos, y dura 15 minutos completos

AUT-01 CA3 pide bloquear 15 minutos tras 5 fallos en 15 minutos. La primera versión contaba
los fallos de los últimos 15 minutos, y **eso no cumple el requisito**: con fallos en los
minutos 0, 1, 2, 3 y 14, el quinto dispara el bloqueo, pero al minuto 15 los cuatro primeros
ya salieron de la ventana y la cuenta se desbloquea a los noventa segundos de bloqueo.

Regla definitiva:

- si hay **5 fallos dentro de los 15 minutos anteriores al último fallo**, la cuenta queda
  bloqueada hasta _último fallo + 15 minutos_;
- un inicio de sesión **exitoso** reinicia el conteo;
- los intentos hechos **durante** el bloqueo se rechazan sin verificar la contraseña y **no
  se registran**, así que no lo prolongan.

Lo último importa tanto como lo primero: si los intentos durante el bloqueo lo extendieran,
cualquiera podría dejar a un usuario fuera de su cuenta indefinidamente con solo repetir
contraseñas equivocadas contra su nombre de usuario.

El bloqueo **no se almacena**. No hay columna `locked_until` que mantener: se deduce de la
tabla `login_attempts`. Es la misma idea de RN-16 —los derivados se calculan— aplicada a la
seguridad, y evita que un reinicio o una escritura perdida dejen a alguien bloqueado para
siempre.

### Revisión en M2a — el bloqueo es solo por cuenta

La primera versión aplicaba la misma regla también por dirección IP. Se retiró antes del
piloto porque **en una finca todos los usuarios comparten la IP pública**: el mismo router o
el mismo punto de datos móviles. Con bloqueo por IP, cinco errores de un operario dejaban sin
acceso a la finca entera durante 15 minutos, y una prueba de M1 afirmaba justamente ese
comportamiento («el bloqueo de alvaro rechaza a wilmer»).

Regla vigente:

- el bloqueo por fallos es **por cuenta** (el `login` normalizado), nunca por IP;
- contra el barrido de contraseñas desde una misma IP basta el **límite de peticiones**:
  60 por minuto sin sesión (Consecuencias), que no depende de que las contraseñas fallen y
  se libera solo al minuto;
- la IP se sigue guardando en `login_attempts` para la trazabilidad de un incidente.

Pruebas: «el bloqueo de una cuenta no afecta a los demás usuarios de la misma IP» y «fallos
repartidos entre varias cuentas desde una IP no bloquean a nadie» (`test/auth.e2e-spec.ts`).

`login_attempts` guarda direcciones IP, que son datos personales: las filas de más de 30 días
se borran al arrancar la API.

## Decisión 3 — El token prueba la sesión; la base decide los permisos

`AccessGuard` verifica el JWT y **después consulta la membresía en la base de datos** en cada
petición. De ahí salen el rol, el estado de la cuenta y el de la membresía; el rol firmado en
el token se ignora.

El motivo es que un token dura quince minutos. Si los permisos vinieran del token, desactivar
a un usuario que acaba de renunciar, o bajarle el rol a alguien que ya no debe ver los datos
económicos (RN-20), tardaría hasta quince minutos en surtir efecto. Con la consulta, aplica en
la siguiente petición. El costo es una lectura por petición sobre el índice único
`(user_id, farm_id)`, que es el tipo de consulta más barata que hay.

Consecuencia comprobada en pruebas: desactivar a un usuario invalida su token vigente, y
cambiarle el rol cambia lo que puede hacer sin necesidad de que vuelva a entrar.

## Decisión 4 — La finca activa viaja en el token y la sesión la recuerda

Un usuario puede pertenecer a varias fincas (el modelo lo permite desde el principio; el seed
hoy pone una sola por usuario). Se eligió lo mínimo que no cierra la puerta al multi-finca:

- `POST /auth/login` acepta un `farmId` **opcional**. Sin él, se entra a la membresía activa
  más antigua (el `id` es UUIDv7, así que ordenarlo es ordenar por fecha de creación).
- La respuesta incluye todas las membresías, para que la web pueda mostrar un selector.
- La fila del token de refresco guarda su `farm_id`, así que **la rotación conserva la finca
  elegida** en lugar de devolver al usuario a la de por defecto.
- Pedir una finca en la que no se tiene membresía activa responde `AUTH_INVALID_CREDENTIALS`,
  no `NOT_FOUND`: el mensaje no debe revelar en qué fincas está alguien.

El día que haga falta cambiar de finca sin volver a entrar, se agrega `POST /auth/switch-farm`
que emite tokens nuevos con otro `farmId`. No se implementa ahora porque nadie lo necesita.

## Decisión 5 — Retiro de DEV_FAKE_AUTH

`DEV_FAKE_AUTH` desaparece del esquema de entorno, de `.env.example`, de `turbo.json`, del
arranque y de las pruebas. `FarmScopeGuard` se borra y `AccessGuard` ocupa su lugar.

Las pruebas de integración se autentican de dos maneras, ambas reales: iniciando sesión contra
la API, o firmando un token con el secreto de prueba (`signTestToken`) cuando hace falta un
token concreto —de otra finca, de un usuario que luego se desactiva, o uno que vencerá al
adelantar el reloj—. Ninguna prueba puede ya fabricarse un ámbito con una cabecera.

## Consecuencias

- No queda ninguna variable de entorno capaz de dejar la API abierta. La prueba que antes
  comprobaba «DEV_FAKE_AUTH no arranca en producción» se reemplazó por una que comprueba que
  la variable, si alguien la deja puesta, sencillamente se ignora.
- Hay una consulta de membresía por petición autenticada.
- Dos cambios de esquema: la tabla `login_attempts` y `refresh_tokens.farm_id`
  (`docs/03-modelo-datos.md` §2.1 actualizado en el mismo commit).
- El límite de peticiones distingue usuario autenticado (300/min) de IP sin autenticar
  (60/min). El segundo es más bajo porque quien no ha entrado solo necesita `/auth/login`,
  `/auth/refresh` y `/health`, y porque el bloqueo por cuenta no frena un barrido de
  contraseñas desde una IP contra muchas cuentas distintas. Es la única defensa por IP: no
  hay bloqueo por IP basado en fallos (revisión de M2a en la Decisión 2).

## Alternativas descartadas

| Alternativa                                                   | Por qué no                                                                                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesión en servidor con cookie de sesión                       | Obliga a consultar el almacén en cada petición y complica el móvil de la fase 2, que guarda el token en el llavero del sistema. El JWT corto ya se valida sin estado. |
| JWT largo sin refresco                                        | Revocar se vuelve imposible sin lista negra, y AUT-03 CA2 exige que desactivar a alguien corte sus sesiones.                                                          |
| Guardar el refresco en claro                                  | Quien leyera la tabla se llevaría todas las sesiones abiertas.                                                                                                        |
| Columna `locked_until` en `users`                             | Un dato derivable convertido en almacenado, y una escritura que puede perderse dejando a alguien bloqueado.                                                           |
| Contar solo los fallos de los últimos 15 minutos              | Incumple AUT-01 CA3: desbloquea antes de tiempo (el caso 0, 1, 2, 3, 14).                                                                                             |
| Bloqueo por IP tras 5 fallos (vigente en M1, retirado en M2a) | Toda la finca comparte la IP pública: los errores de una persona dejarían fuera a todas. El límite de peticiones ya frena el barrido desde una IP.                    |
| Rol y permisos tomados del token                              | Desactivar a alguien tardaría hasta quince minutos en aplicar.                                                                                                        |
| Login que exige siempre `farmId`                              | Estorba al 100 % de los usuarios actuales, que tienen una sola finca, para resolver un caso que todavía no existe.                                                    |
