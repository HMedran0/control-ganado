-- Nombres de catálogo únicos por finca sin distinguir mayúsculas (M3).
--
-- La aplicación guarda el nombre ya normalizado (sin espacios al inicio ni al final, y sin
-- espacios dobles), así que «Brahman», «brahman » y «Brahman» llegan aquí como «Brahman» y
-- «brahman»; estos índices los tratan como el mismo nombre. Prisma no expresa índices sobre
-- expresiones, por eso van en SQL manual (03-modelo-datos.md §5).
--
-- Los índices únicos de Prisma sobre (farm_id, name) se conservan: son más estrictos solo en
-- apariencia, porque cualquier choque exacto ya choca también aquí.

CREATE UNIQUE INDEX "breeds_farm_id_lower_name_key" ON "breeds" ("farm_id", lower("name"));
CREATE UNIQUE INDEX "vaccines_farm_id_lower_name_key" ON "vaccines" ("farm_id", lower("name"));
CREATE UNIQUE INDEX "lots_farm_id_lower_name_key" ON "lots" ("farm_id", lower("name"));
CREATE UNIQUE INDEX "vaccination_cycles_farm_id_lower_name_key" ON "vaccination_cycles" ("farm_id", lower("name"));
CREATE UNIQUE INDEX "tags_farm_id_lower_label_key" ON "tags" ("farm_id", lower("label"));
