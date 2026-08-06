import { Button, StatusMessage } from "@quest-city-web/ui";

/**
 * WEB-M0 placeholder for the Web Student Experience shell (07_02, 07_03 §4).
 * No lesson/activity content, no engines, no authentication — 07_16
 * confirms no auth stub is mandated before the pilot-readiness step. This
 * page only proves the route resolves and honors the baseline accessible
 * shell principles from 07_02 §2 / 07_04 (keyboard-operable, no essential
 * meaning by color alone, announced state).
 */
export default function StudentWebHomePage() {
  return (
    <main>
      <h1>Quest City</h1>
      <StatusMessage kind="empty">
        The Web Student Experience is under construction. This placeholder confirms the{" "}
        <code>/w</code> route is live end-to-end (reverse proxy → student-web app).
      </StatusMessage>
      <Button type="button" disabled>
        Continue (coming soon)
      </Button>
    </main>
  );
}
