import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scan } from "./check-i18n-strings.mjs";

let tempRoot;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("check-i18n-strings", () => {
  it("positive: the real repository has no hardcoded UI text in apps/student-web or apps/dashboard", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const violations = await scan(repoRoot);
    expect(violations).toEqual([]);
  });

  it("negative: detects a hardcoded JSX text node", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qc-i18n-gate-"));
    const pageDir = path.join(tempRoot, "apps", "student-web", "app");
    await mkdir(pageDir, { recursive: true });
    await writeFile(
      path.join(pageDir, "page.tsx"),
      `export default function Page() {\n  return <h1>Totally Hardcoded Heading</h1>;\n}\n`,
      "utf8",
    );

    const violations = await scan(tempRoot);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].file).toContain("page.tsx");
    expect(violations[0].snippet).toContain("Totally Hardcoded Heading");
  });

  it("negative: detects a hardcoded metadata.title string", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qc-i18n-gate-"));
    const pageDir = path.join(tempRoot, "apps", "dashboard", "app");
    await mkdir(pageDir, { recursive: true });
    await writeFile(
      path.join(pageDir, "layout.tsx"),
      `export const metadata = {\n  title: "Hardcoded Title Value",\n};\n`,
      "utf8",
    );

    const violations = await scan(tempRoot);
    expect(violations.some((v) => v.snippet.includes("Hardcoded Title Value"))).toBe(true);
  });

  it("does not flag a route path rendered as JSX text", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qc-i18n-gate-"));
    const pageDir = path.join(tempRoot, "apps", "student-web", "app");
    await mkdir(pageDir, { recursive: true });
    await writeFile(
      path.join(pageDir, "page.tsx"),
      `export default function Page() {\n  return <code>/dashboard</code>;\n}\n`,
      "utf8",
    );

    const violations = await scan(tempRoot);
    expect(violations).toEqual([]);
  });

  it("does not flag an ENUM_LIKE / error-code token rendered as JSX text", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qc-i18n-gate-"));
    const pageDir = path.join(tempRoot, "apps", "dashboard", "app");
    await mkdir(pageDir, { recursive: true });
    await writeFile(
      path.join(pageDir, "page.tsx"),
      `export default function Page() {\n  return <span>ATTEMPT_NOT_COMPLETABLE</span>;\n}\n`,
      "utf8",
    );

    const violations = await scan(tempRoot);
    expect(violations).toEqual([]);
  });

  it("does not flag a t() expression child", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qc-i18n-gate-"));
    const pageDir = path.join(tempRoot, "apps", "student-web", "app");
    await mkdir(pageDir, { recursive: true });
    await writeFile(
      path.join(pageDir, "page.tsx"),
      `export default function Page() {\n  return <h1>{t(CATALOG, "home.title")}</h1>;\n}\n`,
      "utf8",
    );

    const violations = await scan(tempRoot);
    expect(violations).toEqual([]);
  });

  it("does not scan a *.test.tsx fixture file", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "qc-i18n-gate-"));
    const pageDir = path.join(tempRoot, "apps", "student-web", "app");
    await mkdir(pageDir, { recursive: true });
    await writeFile(
      path.join(pageDir, "page.test.tsx"),
      `export default function Page() {\n  return <h1>Hardcoded but in a test file</h1>;\n}\n`,
      "utf8",
    );

    const violations = await scan(tempRoot);
    expect(violations).toEqual([]);
  });
});
