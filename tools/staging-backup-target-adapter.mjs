// Quest City Web — staging backup destination adapter (Tranche E design
// report §18; mission §18: "Do not invent a commercial storage provider...
// Abstract/configure destination... implement and test backup generation/
// encryption/checksum locally using an isolated test target, then classify
// remote off-site validation as pending provider access.")
//
// Two adapters exist: "local" (a filesystem directory standing in for a
// real off-site target during local/staging pipeline validation) and "s3"
// (a real off-site target — Tranche E3 residual closure, GAP-02). Adding
// a further off-site mechanism (a provider-specific gateway, rclone, etc.)
// at some later point means adding a new case here — the interface
// (`upload`, `list`, `download`, `remove`) does not change, and nothing
// above this module needs to change either.
//
// BACKUP_TARGET_ADAPTER selects the adapter; unset/"local" is the default.
// GAP-02 (ACN/MePA Gap Analysis) is NOT closed merely because the "local"
// adapter works — that only proves the pipeline is correct, not that an
// off-site copy actually exists. Selecting "s3" and pointing it at a real
// bucket is what closes it — see the Restore Runbook for the explicit
// closure criterion (a restore drill run against the real off-site
// artifact, not a local copy).

import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

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

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required when BACKUP_TARGET_ADAPTER=s3.`);
  }
  return value;
}

/**
 * Real off-site target (GAP-02). Provider-neutral: any S3-compatible
 * endpoint works (Cloudflare R2, Backblaze B2, Hetzner Object Storage,
 * MinIO, AWS S3 itself, ...) — nothing here is specific to one vendor.
 * `forcePathStyle: true` is required by most non-AWS S3-compatible
 * providers (R2 included); AWS itself also accepts path-style requests,
 * so this is safe as a universal default rather than a per-provider flag.
 *
 * @returns {BackupTargetAdapter}
 */
function s3Adapter(env) {
  const bucket = requiredEnv(env, "BACKUP_S3_BUCKET");
  const endpoint = requiredEnv(env, "BACKUP_S3_ENDPOINT");
  const accessKeyId = requiredEnv(env, "BACKUP_S3_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv(env, "BACKUP_S3_SECRET_ACCESS_KEY");
  const region = env.BACKUP_S3_REGION ?? "auto";
  const prefix = env.BACKUP_S3_PREFIX ? `${env.BACKUP_S3_PREFIX.replace(/\/+$/, "")}/` : "";

  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return {
    async upload(sourcePath, destName) {
      const key = `${prefix}${destName}`;
      const { size } = await stat(sourcePath);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(sourcePath),
          ContentLength: size,
        }),
      );
      return key;
    },
    async list() {
      const keys = [];
      let continuationToken;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix || undefined,
            ContinuationToken: continuationToken,
          }),
        );
        for (const object of page.Contents ?? []) {
          keys.push(object.Key);
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    },
    async download(destIdentifier, localPath) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: destIdentifier }));
      await pipeline(response.Body, createWriteStream(localPath));
    },
    async remove(destIdentifier) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: destIdentifier }));
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
    case "s3":
      return s3Adapter(env);
    default:
      throw new Error(
        `Unknown BACKUP_TARGET_ADAPTER "${adapterName}". Only "local" and "s3" exist today — ` +
          `a further off-site mechanism (provider-specific gateway, rclone, etc.) is an implementation-time ` +
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
