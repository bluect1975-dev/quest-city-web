import { EngineHost } from "../../../../components/engine-host/EngineHost";

/**
 * `/w/engine/{runtimeAdapterId}` (R3C.1 §43). The route param is the
 * ratified `runtimeAdapterId` (`QC-WEB-ENGINE-BALANCE-MACHINE`,
 * `QC-WEB-ENGINE-QUICK-QUESTION`, `QC-WEB-ENGINE-DRAG-DROP`) — the Engine
 * Host resolves it against the same Engine Runtime Registry the server
 * dispatch path uses (`@quest-city-web/learning-engines`), so an unknown
 * id renders the same "not found" state a real unregistered adapter would.
 */
export default async function EngineHostPage({
  params,
}: {
  params: Promise<{ runtimeAdapterId: string }>;
}) {
  const { runtimeAdapterId } = await params;
  return <EngineHost runtimeAdapterId={runtimeAdapterId} />;
}
