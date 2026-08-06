/**
 * Alias normalization for `school_enrollment.access_alias_normalized`
 * uniqueness (`UNIQUE(class_id, access_alias_normalized)`, 02_25 §6.11).
 */
export function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase().normalize("NFKC");
}

/** Class codes are case-insensitive to reduce transcription errors by students. */
export function normalizeClassCode(code: string): string {
  return code.trim().toUpperCase();
}
