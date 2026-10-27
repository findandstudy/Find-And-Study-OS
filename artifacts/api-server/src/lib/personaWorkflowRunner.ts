import type {
  createPersonaScopedMock,
  PersonaMockIdentity,
} from "./personaScopedMock";
/** Bounded local worker tick. No polling, network providers or authority minting.
 * A restart reads durable state; uncertain execution is NEVER dispatched again. */
export function createPersonaWorkflowRunner(
  service: ReturnType<typeof createPersonaScopedMock>,
) {
  return async function step(
    identity: PersonaMockIdentity,
    projectId: string,
    workflowId: number,
  ) {
    const before = await service.workflow(identity, projectId, workflowId);
    if (["RUNNING", "BLOCKED", "CANCELLED", "COMPLETED"].includes(before.state))
      return before;
    const ready = before.nodes.find(
      (node) =>
        node.approval_id && node.status === "QUEUED" && !node.execution_id,
    );
    if (ready) await service.execute(identity, projectId, ready.approval_id);
    return service.advanceWorkflow(identity, projectId, workflowId);
  };
}
