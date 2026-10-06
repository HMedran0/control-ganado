-- Exportación completa de la finca por el ADMIN (BAK-02, M8b; 03 §2, ADR-018). También sirve
-- para el límite de 3 exportaciones por hora por finca, que se deduce de la auditoría.
ALTER TYPE "AuditAction" ADD VALUE 'EXPORT';
