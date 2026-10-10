-- Dónde va el chip RFID (IDN-01, ajuste previo de M9; 03 §2, 08 §1.6): arete, inyectable o bolo
-- ruminal. Opcional: los identificadores existentes quedan sin valor.
CREATE TYPE "RfidCarrier" AS ENUM ('EAR_TAG', 'INJECTABLE', 'BOLUS');

ALTER TABLE "identifiers" ADD COLUMN "carrier" "RfidCarrier";

-- Solo un chip tiene dónde va el chip.
ALTER TABLE "identifiers"
  ADD CONSTRAINT identifiers_carrier_only_rfid_chk
  CHECK (carrier IS NULL OR type = 'RFID');
