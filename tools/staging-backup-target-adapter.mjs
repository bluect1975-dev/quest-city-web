// Quest City Web — staging backup destination adapter (Tranche E design
// report §18; mission §18: "Do not invent a commercial storage provider...
// Abstract/configure destination... implement and test backup generation/
// encryption/checksum locally using an isolated test target, then classify
// remote off-site validation as pending provider access.")
//
// Exactly one adapter exists today: "local", a filesystem directory that
// stands in for a real off-site EU target during local/staging validation.
// It exists so the rest of the backup/restore pipeline (dump, checksum,
// encrypt, retention, restore drill) can be built and genuinely tested end
// to end without inventing a cloud provider. Adding a real off-site adapter
// (an S3-compatible bucket, a provider-specific gateway, rclone, etc.) at
// implementation time means adding a new case here — the interface
// (`upload`, `list`, `download`) does not change, and nothing above this
// module needs to change either.
//
// BACKUP_TARGET_ADAPTER selects the adapter; unset/"local" is the default.
// GAP-02 (ACN/MePA Gap Analysis) is NOT closed merely because the "local"
// adapter works — that only proves the pipeline is correct, not that an
// off-site copy actually exists. See the Restore Runbook for the explicit
// closure criterion.

import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {object} BackupTargetAdapter
 * @property {(sourcePath: string, destName: string) => Promise<string>} upload
 *   Copies/uploads the file at `sourcePath` to the target, named `destName`.
 *   Returns the destination identifier (path/key/URL, adapter-specific).
 * @property {() => Promise<string[]>} list
 *   Returns the destination identifiers of everything currently stored.
 * @property {(destIdentifier: string, localPath: string) => Promise<void>} download
 *   Fetches the object back to `localPath` for a restore.
 * @property {(destIdentifier: string) => Promise<void>} remove
 *   Deletes an object (used by retention enforcement).
 */

/** @returns {BackupTargetAdapter} */
function localAdapter(targetPath) {
  return {
    async upload(sourcePath, destName) {
      await mkdir(targetPath, { recursive: true });
      const dest = path.join(targetPath, destName);
      await copyFile(sourcePath, dest);
      return dest;
    },
    async list() {
      await mkdir(targetPath, { recursive: true });
      const entries = await readdir(targetPath, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.isFile()) {
          files.push(path.join(targetPath, entry.name));
        }
      }
      return files;
    },
    async download(destIdentifier, localPath) {
      await copyFile(destIdentifier, localPath);
    },
    async remove(destIdentifier) {
      await unlink(destIdentifier);
    },
  };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {BackupTargetAdapter}
 */
export function getBackupTargetAdapter(env = process.env) {
  const adapterName = env.BACKUP_TARGET_ADAPTER ?? "local";
  switch (adapterName) {
    case "local":
      return localAdapter(env.BACKUP_TARGET_PATH ?? "/var/backups/quest-city-web/offsite");
    default:
      throw new Error(
        `Unknown BACKUP_TARGET_ADAPTER "${adapterName}". Only "local" exists today (Tranche E design report §18) — ` +
          `a real off-site adapter (S3-compatible bucket, provider gateway, rclone, etc.) is an implementation-time ` +
          `addition, not something invented here.`,
      );
  }
}

export async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
