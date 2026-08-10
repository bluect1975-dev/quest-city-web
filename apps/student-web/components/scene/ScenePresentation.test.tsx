import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenePresentation } from "./ScenePresentation";

/**
 * M06 Web Full Vertical Slice Tranche 5 (`07_26 v1.1` §13/§17): real
 * semantic-role -> asset resolution at the presentation boundary. Exercises
 * the real academy manifest (published roles), the fallback path
 * (unpublished/unknown role, always `QC-THEME-CORE`), and theme-level
 * reduced motion via `matchMedia` (`07_14` §11, `07_15` §9/§16).
 */
function mockMatchMedia(prefersReducedMotion: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? prefersReducedMotion : false,
    media: query,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.push(listener),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return listeners;
}

describe("ScenePresentation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a real academy asset (img with alt text) for a published semantic role", () => {
    mockMatchMedia(false);
    render(<ScenePresentation semanticRoles={["scene.mission_plaza.background"]} />);
    const img = screen.getByAltText("Piazza della missione, accademia, sfondo statico");
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("/theme-assets/academy/academy-scene-mission-plaza-background.svg");
  });

  it("renders the mentor character asset for character.mentor.idle", () => {
    mockMatchMedia(false);
    render(<ScenePresentation semanticRoles={["character.mentor.idle"]} />);
    expect(screen.getByAltText("Ritratto del mentore, in posa di attesa")).toBeInTheDocument();
  });

  it("falls back to the QC-THEME-CORE panel (never blocks) for an unknown semantic role", () => {
    mockMatchMedia(false);
    render(<ScenePresentation semanticRoles={["scene.does_not_exist.background"]} />);
    const fallback = screen.getByRole("img", { name: "scene does not exist background" });
    expect(fallback).toHaveAttribute("data-fallback", "true");
  });

  it("applies data-motion-profile=REDUCED when the user prefers reduced motion", () => {
    mockMatchMedia(true);
    const { container } = render(<ScenePresentation semanticRoles={["scene.mission_plaza.background"]} />);
    expect(container.querySelector(".scenePresentation")).toHaveAttribute("data-motion-profile", "REDUCED");
  });

  it("applies data-motion-profile=STANDARD by default", () => {
    mockMatchMedia(false);
    const { container } = render(<ScenePresentation semanticRoles={["scene.mission_plaza.background"]} />);
    expect(container.querySelector(".scenePresentation")).toHaveAttribute("data-motion-profile", "STANDARD");
  });

  it("renders every declared role, in order", () => {
    mockMatchMedia(false);
    render(<ScenePresentation semanticRoles={["scene.mission_plaza.background", "character.mentor.idle"]} />);
    expect(screen.getByAltText("Piazza della missione, accademia, sfondo statico")).toBeInTheDocument();
    expect(screen.getByAltText("Ritratto del mentore, in posa di attesa")).toBeInTheDocument();
  });
});
