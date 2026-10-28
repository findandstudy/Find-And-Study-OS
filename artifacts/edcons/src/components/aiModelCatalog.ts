export type AiProviderKey = "openai" | "claude";

export type AiModelOption = {
  value: string;
  label: string;
  description: string;
};

/** Curated text-generation models suitable for website writing and translation. */
export const AI_MODEL_OPTIONS: Record<AiProviderKey, AiModelOption[]> = {
  openai: [
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol", description: "Recommended balance of quality and cost" },
    { value: "gpt-6-astra", label: "GPT-6 Astra", description: "Highest quality for demanding work" },
    { value: "gpt-6-luna", label: "GPT-6 Luna", description: "Fast, economical high-volume work" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Previous flagship generation" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "Balanced lower-tier model" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Efficient previous-generation model" },
    { value: "gpt-5.4", label: "GPT-5.4", description: "Affordable general-purpose model" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Smaller model for high-volume work" },
  ],
  claude: [
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", description: "Recommended balance of speed and quality" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5", description: "High-quality knowledge work" },
    { value: "claude-haiku-5-5", label: "Claude Haiku 5.5", description: "Fast, economical high-volume work" },
    { value: "claude-fable-5-1", label: "Claude Fable 5.1", description: "Hard, long-horizon reasoning work" },
  ],
};

export const DEFAULT_AI_MODELS: Record<AiProviderKey, string> = {
  openai: "gpt-6.1-sol",
  claude: "claude-sonnet-5-5",
};

export function modelOptionsForPolicy(provider: "auto" | AiProviderKey): AiModelOption[] {
  return provider === "auto" ? [] : AI_MODEL_OPTIONS[provider];
}
