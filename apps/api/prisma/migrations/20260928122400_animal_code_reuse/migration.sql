-- Numeración reutilizable (M4c): ANI-10, ANI-11, IDN-06 y RN-30 a RN-33.

-- Motivos de retiro que pone el sistema: chapeta liberada al salir (IDN-06) e identificador
-- retirado al archivar el animal (ANI-03, excepción de RN-32). PostgreSQL 16 admite varios
-- ADD VALUE en la misma migración mientras no se usen en ella.
ALTER TYPE "IdentifierRetireReason" ADD VALUE 'EXITED';
ALTER TYPE "IdentifierRetireReason" ADD VALUE 'ARCHIVED';

-- Código normalizado (RN-30). Traducción literal de `normalizeAnimalCode` de
-- packages/shared/src/domain/codes.ts, y test/code-normalization.e2e-spec.ts compara las dos
-- caso por caso (NFD incluido):
--   1. forma NFC;
--   2. sin espacio, tabulador, salto de línea ni espacio duro (U+00A0) al inicio o al final. Lista
--      cerrada: `btrim` sin segundo argumento solo quita espacios, y `trim` de JavaScript quita
--      muchos más;
--   3. mayúsculas con una lista cerrada de letras (a–z, ñ, á, é, í, ó, ú, ü), no con `upper()`,
--      que depende de la configuración regional de la base;
--   4. si queda solo con dígitos ASCII, sin ceros a la izquierda («005» es «5»; «000» es «0»).
CREATE FUNCTION hato_normalize_code(code text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN CASE
    WHEN btrim(normalize(code, NFC), E' \t\n ') ~ '^[0-9]+$'
      THEN coalesce(nullif(ltrim(btrim(normalize(code, NFC), E' \t\n '), '0'), ''), '0')
    ELSE translate(
      btrim(normalize(code, NFC), E' \t\n '),
      'abcdefghijklmnopqrstuvwxyzñáéíóúü',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZÑÁÉÍÓÚÜ')
  END;

-- Antes de cambiar el índice: ningún código normalizado puede estar repetido entre los animales
-- activos, ni —en las fincas que no reutilizan números— entre todos los no archivados. Si hay
-- alguno, la migración falla nombrando la finca y los códigos, para corregirlos a mano.
DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(format('%s: %s', farm_name, codes), '; ' ORDER BY farm_name, codes)
    INTO duplicates
    FROM (
      SELECT f.name AS farm_name, string_agg(a.code, ', ' ORDER BY a.code) AS codes
        FROM animals a
        JOIN farms f ON f.id = a.farm_id
       WHERE a.deleted_at IS NULL
         AND (a.exit_type IS NULL OR coalesce(f.settings ->> 'codeReuse', 'false') <> 'true')
       GROUP BY f.name, a.farm_id, hato_normalize_code(a.code)
      HAVING count(*) > 1
    ) AS repeated;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Hay animales con el mismo código normalizado (RN-30): %. Cambia esos códigos antes de aplicar la migración.', duplicates;
  END IF;
END
$$;

-- RN-31: la base garantiza la unicidad del código normalizado entre los animales **activos**. La
-- regla más estricta de las fincas sin reutilización (única entre todos los no archivados) la
-- verifica la aplicación dentro de la transacción, con un candado por código (assertCodeAvailable).
DROP INDEX animals_farm_code_active_uq;

CREATE UNIQUE INDEX animals_farm_code_norm_active_uq
  ON animals (farm_id, hato_normalize_code(code))
  WHERE deleted_at IS NULL AND exit_type IS NULL;

-- Búsqueda exacta, número anterior (ANI-11) y la verificación de las fincas sin reutilización:
-- todos los animales, también los que salieron o están archivados.
CREATE INDEX animals_farm_code_norm_idx
  ON animals (farm_id, hato_normalize_code(code));
