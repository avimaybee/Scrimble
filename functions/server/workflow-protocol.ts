export const GENERATION_WORKFLOW_PROTOCOL_VERSION = 1 as const;

export function assertWorkflowProtocolVersion(version: unknown) {
  if (version !== GENERATION_WORKFLOW_PROTOCOL_VERSION) {
    throw new Error(
      `Workflow protocol mismatch. Expected ${GENERATION_WORKFLOW_PROTOCOL_VERSION}, received ${String(version)}.`,
    );
  }
}
