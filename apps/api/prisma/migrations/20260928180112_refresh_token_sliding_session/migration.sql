-- Sesión deslizante con tope absoluto (AUT-10, AUT-11, ADR-007 decisión 6).
--
-- Las columnas se agregan sin NOT NULL, se rellenan y después se exigen: la tabla ya tiene filas.
-- `family_started_at` de los tokens existentes es la creación del primer token de su familia,
-- que es el inicio de sesión que la originó. `last_used_at` es la creación de cada token: el
-- último momento en que se sabe que la sesión se usó.

ALTER TABLE "refresh_tokens"
  ADD COLUMN "family_started_at" TIMESTAMPTZ,
  ADD COLUMN "last_used_at" TIMESTAMPTZ;

UPDATE "refresh_tokens" AS t
   SET "family_started_at" = f.started_at,
       "last_used_at" = t."created_at"
  FROM (
    SELECT "family_id", min("created_at") AS started_at
      FROM "refresh_tokens"
     GROUP BY "family_id"
  ) AS f
 WHERE f."family_id" = t."family_id";

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "family_started_at" SET NOT NULL,
  ALTER COLUMN "last_used_at" SET NOT NULL;

