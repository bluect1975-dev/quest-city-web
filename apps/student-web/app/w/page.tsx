import Link from "next/link";
import { Button, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";

const P0_ENGINES = [
  { runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE", nameKey: "engines.balance.name", descriptionKey: "engines.balance.description" },
  { runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION", nameKey: "engines.quick.name", descriptionKey: "engines.quick.description" },
  { runtimeAdapterId: "QC-WEB-ENGINE-DRAG-DROP", nameKey: "engines.drag.name", descriptionKey: "engines.drag.description" },
] as const;

/**
 * WEB-M0 placeholder shell (07_02, 07_03 §4), still no lesson/activity
 * content or authentication (07_16). R3C.1 adds a real, working section
 * below the placeholder: links into the minimal Engine Host (§43) for the
 * 3 P0 Learning Engines — this is a demonstration/testing surface, not the
 * M06 vertical slice.
 */
export default function StudentWebHomePage() {
  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "home.title")}</h1>
      <StatusMessage kind="empty">
        {t(STUDENT_WEB_CATALOG_IT_IT, "home.underConstructionBefore")} <code>/w</code>{" "}
        {t(STUDENT_WEB_CATALOG_IT_IT, "home.underConstructionAfter")}
      </StatusMessage>
      <Button type="button" disabled>
        {t(STUDENT_WEB_CATALOG_IT_IT, "home.continueButton")}
      </Button>

      <section>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.index.title")}</h2>
        <p>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.index.description")}</p>
        <ul>
          {P0_ENGINES.map((entry) => (
            <li key={entry.runtimeAdapterId}>
              <h3>{t(STUDENT_WEB_CATALOG_IT_IT, entry.nameKey)}</h3>
              <p>{t(STUDENT_WEB_CATALOG_IT_IT, entry.descriptionKey)}</p>
              <Link href={`/w/engine/${entry.runtimeAdapterId}`}>{t(STUDENT_WEB_CATALOG_IT_IT, "engines.index.openButton")}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.title")}</h2>
        <p>{t(STUDENT_WEB_CATALOG_IT_IT, "sequence.description")}</p>
        <Link href="/w/sequence">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.index.openButton")}</Link>
      </section>
    </main>
  );
}
