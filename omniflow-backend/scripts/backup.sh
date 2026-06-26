#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OmniFlow Production Database Backup Script
# ─────────────────────────────────────────────────────────────────────────────

# Exit immediately if a command exits with a non-zero status
set -e

# Configurable variables
DB_NAME=${POSTGRES_DB:-"omniflow_prod"}
DB_USER=${POSTGRES_USER:-"postgres"}
DB_PASSWORD=${POSTGRES_PASSWORD:-"Deepakswamy@123"}
DB_HOST=${POSTGRES_HOST:-"postgres"}
DB_PORT=${POSTGRES_PORT:-"5432"}

BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_backup_${TIMESTAMP}.sql.gz"

echo "[Backup] Starting PostgreSQL backup for ${DB_NAME} at $(date)"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

# Execute pg_dump and compress to gzip
PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  | gzip > "${BACKUP_FILE}"

echo "[Backup] Snapshot successfully saved to ${BACKUP_FILE}"

# Optional: cleanup backups older than 7 days
find "${BACKUP_DIR}" -type f -name "${DB_NAME}_backup_*.sql.gz" -mtime +7 -delete

echo "[Backup] Completed at $(date)"
