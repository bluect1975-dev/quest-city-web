import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBackupTargetAdapter } from "./staging-backup-target-adapter.mjs";

let tempRoot;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("getBackupTargetAdapter", () => {
  it("defaults to the local adapter when BACKUP_TARGET_ADAPTER is unset", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qcweb-backup-target-"));
    const adapter = getBackupTargetAdapter({ BACKUP_TARGET_PATH: tempRoot });
    expect(adapter).toBeDefined();
    expect(await adapter.list()).toEqual([]);
  });

  it("throws for an unknown adapter name rather than silently falling back", () => {
    expect(() => getBackupTargetAdapter({ BACKUP_TARGET_ADAPTER: "azure-blob" })).toThrow(/Unknown BACKUP_TARGET_ADAPTER/);
  });

  describe("s3 adapter", () => {
    const validS3Env = {
      BACKUP_TARGET_ADAPTER: "s3",
      BACKUP_S3_BUCKET: "qcweb-staging-backups",
      BACKUP_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      BACKUP_S3_ACCESS_KEY_ID: "test-access-key-id",
      BACKUP_S3_SECRET_ACCESS_KEY: "test-secret-access-key",
    };

    it("constructs successfully with the expected interface when all required vars are set", () => {
      const adapter = getBackupTargetAdapter(validS3Env);
      expect(adapter.upload).toBeInstanceOf(Function);
      expect(adapter.list).toBeInstanceOf(Function);
      expect(adapter.download).toBeInstanceOf(Function);
      expect(adapter.remove).toBeInstanceOf(Function);
    });

    it.each(["BACKUP_S3_BUCKET", "BACKUP_S3_ENDPOINT", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"])(
      "throws when %s is missing rather than silently defaulting",
      (missingVar) => {
        const { [missingVar]: _omit, ...envWithoutVar } = validS3Env;
        expect(() => getBackupTargetAdapter(envWithoutVar)).toThrow(new RegExp(`${missingVar} is required`));
      },
    );
  });

  it("uploads, lists, downloads, and removes round-trip correctly", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qcweb-backup-target-"));
    const targetDir = path.join(tempRoot, "offsite");
    const adapter = getBackupTargetAdapter({ BACKUP_TARGET_ADAPTER: "local", BACKUP_TARGET_PATH: targetDir });

    const sourceFile = path.join(tempRoot, "source.txt");
    await writeFile(sourceFile, "backup contents");

    const destIdentifier = await adapter.upload(sourceFile, "backup-1.enc");
    expect(await adapter.list()).toEqual([destIdentifier]);

    const downloadedPath = path.join(tempRoot, "downloaded.txt");
    await adapter.download(destIdentifier, downloadedPath);
    expect((await readFile(downloadedPath, "utf8"))).toBe("backup contents");

    await adapter.remove(destIdentifier);
    expect(await adapter.list()).toEqual([]);
  });

  it("does not mutate the source file on upload (copy, not move)", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qcweb-backup-target-"));
    const adapter = getBackupTargetAdapter({ BACKUP_TARGET_ADAPTER: "local", BACKUP_TARGET_PATH: path.join(tempRoot, "offsite") });
    const sourceFile = path.join(tempRoot, "source.txt");
    await writeFile(sourceFile, "still here after upload");
    await adapter.upload(sourceFile, "backup-1.enc");
    expect(await readFile(sourceFile, "utf8")).toBe("still here after upload");
  });
});
