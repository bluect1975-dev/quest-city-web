import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Mirrors packages/ui/vitest-setup.ts. @testing-library/react's automatic
 * afterEach cleanup only registers itself when it detects vitest's
 * `globals: true` mode — this project deliberately imports
 * `describe`/`it`/`expect` explicitly instead (matching every other
 * package's vitest config), so cleanup must be wired manually or every
 * render() after the first in a file leaks DOM nodes into the next test.
 */
afterEach(() => {
  cleanup();
});
