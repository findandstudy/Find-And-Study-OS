import type { PipelineStage } from "@/hooks/use-pipeline-stages";

/**
 * Resolve the generic completion target of an application stage.
 *
 * The missing-document names are legacy API aliases for the same stored
 * value. Keeping the fallback here lets older server responses continue to
 * work while all new UI writes use the generic completion-target contract.
 */
export function resolveStageCompletionTargetKey(
  sourceStage: PipelineStage | undefined,
  allStages: PipelineStage[],
): string | null {
  if (!sourceStage) return null;

  const key = sourceStage.completionTargetStageKey
    ?? sourceStage.missingDocsFulfilledTargetStageKey;
  if (key) return key;

  const id = sourceStage.completionTargetStageId
    ?? sourceStage.missingDocsFulfilledTargetStageId;
  if (!id) return null;

  return allStages.find((stage) => stage.id === id)?.key ?? null;
}
