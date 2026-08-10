import { createHash } from "node:crypto";
import type { WebContentBundleManifest } from "../bundle-loader";
import type { SequenceDefinition } from "../stage-orchestration-types";

/**
 * M06 Web Full Vertical Slice — Tranche 5 real content materialization
 * (`07_26 v1.1` §13/§17): `INTRO_HOOK`, the eighth and last canonical
 * stage (`07_13 v1.3` §4) to be assigned an implementation tranche —
 * `07_26 v1.1` §17.3 formally assigns it to Tranche 5 ("dipende
 * esclusivamente dalla disponibilità della scena Mission Plaza... già
 * nello scope esplicito della Tranche 5"). Source, read-only, from
 * `quest-city-roblox` canonical `main` @
 * `581e28a6f943e178108ee2189ea98782fc089f03`:
 *
 *  - `docs/03-mathematics/03_13_..._M06_Lesson_Package_Specification_v1_0.md`
 *    §4 (phase titles "Ingresso e orientamento"/"Hook narrativo", L0/L1),
 *    §6 ("Testi definitivi UI" — objective chip, primary CTA — DEFINITIVE
 *    text, preferred over §5's script prose where the two differ), §7
 *    ("Dialoghi definitivi" — Prof. Argo's L1-start line, DEFINITIVE text).
 *  - `docs/03-mathematics/03_16_..._Narrative_Dialogue_and_Subtitle_Pack_v1_0.md`
 *    §2 (cast: NPC-MAT-001 Prof. Argo), §3 (narrative arc: "Arrival"/
 *    "Brief" beats — L0/L1's narrative function).
 *  - `docs/07-web-learing-platform/07_12_..._Vertical_Slice_Production_
 *    Specification_v1_1.md` §4 (Mission Plaza node, role "orientamento e
 *    navigazione"), §7 (`QC-SCENE-MISSION-PLAZA` scene template ID).
 *  - `docs/07-web-learing-platform/07_26_..._Canonical_Completion_
 *    Definition_v1_1.md` §17.2 (canonical INTRO_HOOK definition table:
 *    non-interactive, no engine, orchestration-owned, no MAT.* objective).
 *
 * Architecture (evidence, not assumption, per `07_26 v1.1` §17.2): L0/L1
 * assign no `MAT.*` competency (`03_13` §1's first evidence, `EV-M06-L01-
 * 01`, emerges at L2 = `PREREQUISITE_CHECK`) and involve no graded
 * interaction (`03_13` §5 "Interazione" column for L0/L1: "Tap/approccio
 * al terminale" / "Continua" — no semantic action from `07_13` §10's
 * vocabulary). Per `02_36` §20-bis.2's own rule (a Learning Engine
 * requires "una responsabilità pedagogico-interattiva autonoma"), this
 * stage belongs to the orchestration layer, exactly like
 * `REFLECTION_AND_RESULT` (Tranche 1) and `MICRO_LESSON` (Tranche 3) — no
 * `activityRef`, no `engineDispatchRef`, no `ActivityDefinition` (which
 * would force a fake `objectiveIds`/`validatorRef` onto a stage that
 * canonically has neither — `activity-definition.schema.json` requires
 * both, `INTRO_HOOK` has neither, so this stage deliberately does not
 * claim that schema's shape, exactly like the `MICRO_LESSON` sub-stages
 * before it).
 *
 * Presentation (M06 Web Full Vertical Slice Tranche 5's actual scope,
 * `07_26 v1.1` §17.3): scene `QC-SCENE-MISSION-PLAZA` (`07_12` §4/§7),
 * semantic roles `scene.mission_plaza.background` and
 * `character.mentor.idle`, both resolved at runtime via
 * `@quest-city-web/theme-system`'s `resolveSceneAssets` — never a
 * hardcoded filename (`07_14` §18).
 */

export const WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID = "f3a1c9e2-7b4d-4a6e-9c1f-2d8b5a7e3c60";
export const WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID = "MAT-M06-U01-intro-hook";
export const WEB_TRANCHE5_CONTENT_BUNDLE_PUBLIC_ID = "bnd_web_tranche5_intro_hook";
export const WEB_TRANCHE5_ASSIGNMENT_PUBLIC_ID = "asn_web_tranche5_intro_hook";
export const WEB_TRANCHE5_INTRO_HOOK_STAGE_ID = "intro-hook";
export const WEB_TRANCHE5_INTRO_HOOK_SCENE_ID = "QC-SCENE-MISSION-PLAZA";

/**
 * `03_13` §6 (objective chip, DEFINITIVE — supersedes §5's script
 * paraphrase "Raggiungi la stazione di equilibrio") + §7 (L1-start
 * dialogue, DEFINITIVE — supersedes §5's script paraphrase). No text
 * altered, none merged, none invented — L0's UI text and L1's dialogue
 * combined into a single Web `INTRO_HOOK` stage (`07_26 v1.1` §17.2:
 * "corrispondenza strutturale imperfetta" between the Roblox L0-L8 phases
 * and the Web 8-stage sequence is expected, documented, not a defect).
 */
export const WEB_TRANCHE5_INTRO_HOOK_CONTENT = {
  objectiveChipText: "Mantieni uguali i due membri",
  mentorDialogueText: "La Balance Machine confronta due lati. Se cambiamo un lato, dobbiamo fare lo stesso sull'altro.",
  primaryCtaText: "Continua",
  sceneId: WEB_TRANCHE5_INTRO_HOOK_SCENE_ID,
  semanticRoles: ["scene.mission_plaza.background", "character.mentor.idle"],
  provenance: {
    sourceRepository: "quest-city-roblox",
    sourceCommit: "581e28a6f943e178108ee2189ea98782fc089f03",
    sourceDocuments: [
      "docs/03-mathematics/03_13_Quest_City_Mathematics_M06_Lesson_Package_Specification_v1_0.md#4-struttura-l0-l8",
      "docs/03-mathematics/03_13_Quest_City_Mathematics_M06_Lesson_Package_Specification_v1_0.md#6-testi-definitivi-ui",
      "docs/03-mathematics/03_13_Quest_City_Mathematics_M06_Lesson_Package_Specification_v1_0.md#7-dialoghi-definitivi",
      "docs/03-mathematics/03_16_Quest_City_Mathematics_Vertical_Slice_Narrative_Dialogue_and_Subtitle_Pack_v1_0.md#3-arco-del-vertical-slice",
      "docs/07-web-learing-platform/07_12_Quest_City_Web_M06_Vertical_Slice_Production_Specification_v1_1.md#4-experience-map-m06-web",
      "docs/07-web-learing-platform/07_26_Quest_City_Web_M06_Full_Vertical_Slice_Canonical_Completion_Definition_v1_1.md#172",
    ],
  },
} as const;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

const entryContentJson = JSON.stringify(WEB_TRANCHE5_INTRO_HOOK_CONTENT);
const entryDigest = sha256Hex(entryContentJson);

const manifestCore = {
  bundleSchemaVersion: "2.0.0",
  bundleId: "web-tranche5-intro-hook-v1",
  bundleVersion: "1.0.0",
  bundleType: "ACTIVITY_BUNDLE" as const,
  status: "PUBLISHED" as const,
  subjectId: "MAT",
  moduleId: "MAT-M06",
  contentVersion: "1.0.0",
  publishedAt: "2026-08-10T00:00:00.000Z",
  compatibleRuntimes: ["WEB"] as const,
  capabilityRequirements: ["html"],
  fallbacksDeclared: true,
  entries: [
    {
      entryId: WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID,
      // Deliberately not "activity": INTRO_HOOK has no objectives/validator
      // (07_26 v1.1 §17.2) — this entry is presentation content, not an
      // ActivityDefinition, and `entryType` is a free string (`bundle-
      // entry.schema.json` places no enum constraint on it).
      entryType: "presentation",
      path: `activities/${WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID}.json`,
      schemaRef: "qc://schemas/intro-hook-presentation-content/1.0.0",
      contentDigest: `sha256:${entryDigest}`,
      required: true,
    },
  ],
};

const manifestDigest = sha256Hex(JSON.stringify(manifestCore));

/** Real, schema-validated manifest (validated at seed time via `loadBundleManifest`, not invented shape). */
export const WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST: WebContentBundleManifest = {
  ...manifestCore,
  integrity: { algorithm: "sha256", digest: manifestDigest },
};

export const WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ENTRY_CONTENT_JSON = entryContentJson;

/**
 * Single-stage sequence (`07_13` §4 canonical `stageType`): `INTRO_HOOK`,
 * `order: 0`, `isInteractive: false` — same non-interactive,
 * orchestration-advanced pattern already proven by `REFLECTION_AND_RESULT`
 * (Tranche 1) and every `MICRO_LESSON` sub-stage (Tranche 3): no
 * `activityRef`, no `engineDispatchRef`, no `progressionRule` (advance is
 * driven purely by `SequenceHost`'s "Continua" button -> `advanceStage`).
 */
export const WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: `web-tranche5-${WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID}`,
  sequenceVersion: "1.0.0",
  stages: [
    {
      stageId: WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
      stageType: "INTRO_HOOK",
      order: 0,
      isInteractive: false,
    },
  ],
};
