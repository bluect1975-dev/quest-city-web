const MIGRATION_FILENAME_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export function isMigrationFile(filename) {
  return MIGRATION_FILENAME_PATTERN.test(filename);
}
