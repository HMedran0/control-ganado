-- Cierre de todas las sesiones de un usuario por el ADMIN (AUT-11 CA3, M4d; 03 §2).
ALTER TYPE "AuditAction" ADD VALUE 'REVOKE_SESSIONS';
