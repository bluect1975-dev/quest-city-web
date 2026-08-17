export {
  SupportStudentAssignmentRepository,
  type SupportStudentAssignment,
  type SupportStudentAssignmentStatus,
} from "./repository/support-student-assignment-repository";
export {
  LearningSupportEventRepository,
  type LearningSupportEvent,
  type SupportActorRole,
  type SupportType,
  type SupportIntensity,
} from "./repository/learning-support-event-repository";
export {
  LearningSupportObservationRepository,
  type LearningSupportObservation,
  type ObservationActorRole,
} from "./repository/learning-support-observation-repository";
export {
  FacilitationProposalRepository,
  type FacilitationProposal,
  type FacilitationProposalType,
  type FacilitationProposalStatus,
} from "./repository/facilitation-proposal-repository";
export {
  SupportProfileRepository,
  type SupportProfileEntry,
  type SupportProfileCategory,
  type SupportProfileLevel,
  type SupportProfileStatus,
  type SupportProfileAppliedByRole,
} from "./repository/support-profile-repository";
export { DifficultyOverrideRepository, type DifficultyOverride } from "./repository/difficulty-override-repository";

export { resolveStudentSupportScope, assertStudentSupportScope, type StudentSupportScopeResult } from "./services/support-scope";
export { SupportAssignmentService } from "./services/support-assignment-service";
export { SupportEventService } from "./services/support-event-service";
export { ObservationService, type ObservationHistoryEntry } from "./services/observation-service";
export { FacilitationService } from "./services/facilitation-service";
export { FacilitationProposalService } from "./services/facilitation-proposal-service";
