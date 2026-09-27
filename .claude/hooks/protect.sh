#!/usr/bin/env bash
# Bloquea escrituras en archivos protegidos. Exit 2 = bloquear y explicar a Claude.
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0
REL="${FILE#"$CLAUDE_PROJECT_DIR"/}"

case "$REL" in
  .env|.env.*|*/.env|*/.env.*)
    [ "$(basename "$REL")" = ".env.example" ] && exit 0
    echo "Bloqueado: no se editan archivos .env con secretos. Usa .env.example para documentar variables." >&2
    exit 2 ;;
  docs/referencia/*)
    echo "Bloqueado: docs/referencia/ es la especificación de partida. Si el hito requiere cambiarla, pide autorización al usuario." >&2
    exit 2 ;;
  apps/api/prisma/migrations/*/migration.sql)
    # Una migración versionada en git ya pudo aplicarse en otra base: no se toca. Una recién
    # generada que aún no tiene commit sí se puede ajustar (por ejemplo, para añadirle SQL que
    # Prisma no expresa). Si no se puede consultar git, se bloquea: ante la duda, se protege.
    if ! git -C "$CLAUDE_PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "Bloqueado: no se pudo consultar git para saber si la migración ya está versionada." >&2
      exit 2
    fi
    if git -C "$CLAUDE_PROJECT_DIR" ls-files --error-unmatch -- "$REL" >/dev/null 2>&1; then
      echo "Bloqueado: la migración ya está versionada en git. Crea una nueva migración." >&2
      exit 2
    fi ;;
esac
exit 0
