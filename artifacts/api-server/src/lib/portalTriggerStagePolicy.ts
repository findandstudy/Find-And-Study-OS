export interface PortalTriggerStageCandidate {
  key: string;
  label: string;
  sortOrder: number;
  variant?: string | null;
  isCaseClose?: boolean | null;
}

export interface PortalTriggerStageOption {
  key: string;
  label: string;
  sortOrder: number;
  variant: string | null;
  isCaseClose: boolean;
  eligible: boolean;
  ineligibleReason: "terminal_stage" | null;
}

export interface PortalTriggerStageSnapshot {
  stages: PortalTriggerStageOption[];
  configuredKeys: string[];
  validConfiguredKeys: string[];
  staleConfiguredKeys: string[];
  ineligibleConfiguredKeys: string[];
}

/**
 * Trigger-stage keys are persisted as the pipeline stage's immutable business
 * key.  Trim and de-duplicate them without guessing aliases or changing case;
 * an unknown value must remain visible to validation and reconciliation.
 */
export function normalizePortalTriggerStageKeys(
  values: readonly string[],
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const key = String(value).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

export function isPortalTriggerStageEligible(
  stage: Pick<PortalTriggerStageCandidate, "variant" | "isCaseClose">,
): boolean {
  const variant = String(stage.variant ?? "")
    .trim()
    .toLowerCase();
  return stage.isCaseClose !== true && variant !== "won" && variant !== "lost";
}

/**
 * Join the authoritative Application Pipeline with the saved automation
 * selection.  This is deliberately fail-closed: removed/unknown keys and
 * terminal stages are reported separately and are never treated as runnable.
 */
export function buildPortalTriggerStageSnapshot(
  stages: readonly PortalTriggerStageCandidate[],
  configuredValues: readonly string[],
): PortalTriggerStageSnapshot {
  const configuredKeys = normalizePortalTriggerStageKeys(configuredValues);
  const options = [...stages]
    .map((stage): PortalTriggerStageOption => {
      const eligible = isPortalTriggerStageEligible(stage);
      return {
        key: stage.key,
        label: stage.label,
        sortOrder: stage.sortOrder,
        variant: stage.variant ?? null,
        isCaseClose: stage.isCaseClose === true,
        eligible,
        ineligibleReason: eligible ? null : "terminal_stage",
      };
    })
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.key.localeCompare(right.key),
    );

  const byKey = new Map(options.map((stage) => [stage.key, stage]));
  const staleConfiguredKeys = configuredKeys.filter((key) => !byKey.has(key));
  const ineligibleConfiguredKeys = configuredKeys.filter((key) => {
    const stage = byKey.get(key);
    return stage !== undefined && !stage.eligible;
  });
  const validConfiguredKeys = configuredKeys.filter(
    (key) => byKey.get(key)?.eligible === true,
  );

  return {
    stages: options,
    configuredKeys,
    validConfiguredKeys,
    staleConfiguredKeys,
    ineligibleConfiguredKeys,
  };
}
