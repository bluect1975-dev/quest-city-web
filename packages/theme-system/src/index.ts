export { QC_THEME_CORE, QC_THEME_ACADEMY, resolveTheme, type ThemePackage } from "./theme-package";
export { type MotionProfile, pickMotionProfile } from "./motion-profile";
export {
  type SceneDisplayMode,
  type SceneTemplate,
  QC_SCENE_CORE_PANEL,
  SCENE_TEMPLATE_REGISTRY,
  resolveSceneTemplate,
} from "./scene-registry";
export {
  type AssetManifestEntry,
  type ResolvedSemanticRole,
  resolveSemanticRole,
  resolveSceneAssets,
} from "./asset-manifest";
export {
  type SpriteCookBatchJob,
  MISSION_PLAZA_BACKGROUND_SVG,
  MENTOR_IDLE_SVG,
  UI_ICON_SHEET_SVG,
  sliceIconSheet,
  runSpriteCookBatch,
  SPRITECOOK_INTEGRATION_STATUS,
} from "./sprite-cook-batch";
export { ACADEMY_ASSET_MANIFEST, ACADEMY_SPRITE_COOK_JOBS, ACADEMY_ASSET_SOURCES } from "./academy-manifest";
