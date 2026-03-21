import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface PipelineStage {
  id?: number;
  entityType: string;
  key: string;
  label: string;
  sortOrder: number;
  variant?: string | null;
  icon?: string | null;
  color?: string | null;
}

async function fetchStages(entityType: string): Promise<PipelineStage[]> {
  const r = await fetch(`${BASE_URL}/api/pipeline-stages/${entityType}`, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function deduplicateStages(stages: PipelineStage[]): PipelineStage[] {
  const seen = new Set<string>();
  return stages.filter(s => {
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
}

async function saveStages(entityType: string, stages: PipelineStage[]): Promise<PipelineStage[]> {
  const r = await fetch(`${BASE_URL}/api/pipeline-stages/${entityType}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stages }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function usePipelineStages(entityType: string) {
  const queryClient = useQueryClient();

  const query = useQuery<PipelineStage[]>({
    queryKey: ["pipeline-stages", entityType],
    queryFn: () => fetchStages(entityType),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const uniqueStages = useMemo(
    () => deduplicateStages(query.data ?? []),
    [query.data]
  );

  const mutation = useMutation({
    mutationFn: (stages: PipelineStage[]) => saveStages(entityType, stages),
    onSuccess: (data) => {
      queryClient.setQueryData(["pipeline-stages", entityType], data);
    },
  });

  return {
    stages: uniqueStages,
    isLoading: query.isLoading,
    saveStages: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
