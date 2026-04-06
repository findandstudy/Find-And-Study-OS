import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Loader2, Wand2, Type, FileText, MessageSquare,
  Maximize2, Minimize2, ArrowRight,
} from "lucide-react";

interface AiAction {
  key: string;
  label: string;
  icon: typeof Type;
  needsContext?: boolean;
}

const AI_ACTIONS: AiAction[] = [
  { key: "generateMetaTitle", label: "Meta Title", icon: Type },
  { key: "generateMetaDescription", label: "Meta Description", icon: FileText },
  { key: "generateExcerpt", label: "Excerpt", icon: MessageSquare },
  { key: "generateHeroTitle", label: "Hero Title", icon: Wand2, needsContext: true },
  { key: "generateCTAText", label: "CTA Text", icon: ArrowRight, needsContext: true },
  { key: "generateOGText", label: "OG Text", icon: FileText, needsContext: true },
  { key: "generateBlogOutline", label: "Blog Outline", icon: FileText, needsContext: true },
  { key: "generateAltText", label: "Alt Text", icon: Type, needsContext: true },
  { key: "improveTone", label: "Improve Tone", icon: Sparkles, needsContext: true },
  { key: "shortenText", label: "Shorten", icon: Minimize2, needsContext: true },
  { key: "expandText", label: "Expand", icon: Maximize2, needsContext: true },
];

interface AiAssistantPanelProps {
  context?: string;
  locale?: string;
  onResult?: (action: string, result: string) => void;
  compact?: boolean;
}

export function AiAssistantPanel({ context: defaultContext, locale, onResult, compact }: AiAssistantPanelProps) {
  const { toast } = useToast();
  const [contextInput, setContextInput] = useState(defaultContext || "");
  const [result, setResult] = useState("");
  const [lastAction, setLastAction] = useState("");

  const { data: aiStatus } = useQuery<{ configured: boolean; provider: string | null }>({
    queryKey: ["/api/website/ai/status"],
    queryFn: () => customFetch("/api/website/ai/status"),
    staleTime: 60000,
  });

  const generateMutation = useMutation({
    mutationFn: (payload: { action: string; context: string; locale?: string }) =>
      customFetch("/api/website/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (data: unknown) => {
      const d = data as { result: string; action: string };
      setResult(d.result);
      setLastAction(d.action);
    },
    onError: (e: Error) => toast({ title: "AI Error", description: e.message, variant: "destructive" }),
  });

  const configured = aiStatus?.configured ?? false;

  function handleAction(action: AiAction) {
    const ctx = action.needsContext ? contextInput : (contextInput || defaultContext || "website content");
    if (action.needsContext && !ctx.trim()) {
      toast({ title: "Please provide context", description: "Enter text or context for the AI to work with.", variant: "destructive" });
      return;
    }
    generateMutation.mutate({ action: action.key, context: ctx, locale });
  }

  function handleApply() {
    if (result && onResult && lastAction) {
      onResult(lastAction, result);
      toast({ title: "Applied" });
    }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={configured ? "default" : "secondary"} className="text-[10px] gap-1">
          <Sparkles className="w-3 h-3" /> AI {configured ? "Ready" : "Not Configured"}
        </Badge>
        {!configured && (
          <span className="text-[10px] text-muted-foreground">Configure AI in Settings &gt; Integrations</span>
        )}
      </div>
    );
  }

  return (
    <div className="border rounded-xl p-4 space-y-3 bg-gradient-to-b from-violet-50/50 to-background">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-violet-600" /> AI Content Assistant
        </h4>
        <Badge variant={configured ? "default" : "secondary"} className="text-[10px]">
          {configured ? `${aiStatus?.provider || "AI"} Connected` : "Not Configured"}
        </Badge>
      </div>

      {!configured ? (
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <p className="font-medium">AI assistant is not configured.</p>
          <p className="text-xs mt-1">Go to Settings &gt; Integrations and enable the AI Content integration with your API key.</p>
        </div>
      ) : (
        <>
          <div>
            <Textarea
              value={contextInput}
              onChange={e => setContextInput(e.target.value)}
              placeholder="Enter context or text for AI to work with..."
              rows={2}
              className="text-xs"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {AI_ACTIONS.map(action => (
              <Button
                key={action.key}
                variant="outline"
                size="sm"
                className="text-[11px] h-7 gap-1"
                disabled={generateMutation.isPending}
                onClick={() => handleAction(action)}
              >
                <action.icon className="w-3 h-3" /> {action.label}
              </Button>
            ))}
          </div>

          {generateMutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Generating...
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="bg-white border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Result:</p>
                <p className="text-sm whitespace-pre-wrap">{result}</p>
              </div>
              {onResult && (
                <Button size="sm" className="text-xs gap-1" onClick={handleApply}>
                  <Wand2 className="w-3 h-3" /> Apply to Field
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface AiFieldButtonProps {
  action: string;
  context: string;
  locale?: string;
  onResult: (result: string) => void;
  label?: string;
}

export function AiFieldButton({ action, context, locale, onResult, label }: AiFieldButtonProps) {
  const { toast } = useToast();

  const { data: aiStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/website/ai/status"],
    queryFn: () => customFetch("/api/website/ai/status"),
    staleTime: 60000,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      customFetch("/api/website/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, context, locale }),
      }),
    onSuccess: (data: unknown) => {
      const d = data as { result: string };
      onResult(d.result);
    },
    onError: (e: Error) => toast({ title: "AI Error", description: e.message, variant: "destructive" }),
  });

  const configured = aiStatus?.configured ?? false;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-[10px] h-6 gap-1 text-violet-600 hover:text-violet-700"
      disabled={!configured || generateMutation.isPending}
      onClick={() => generateMutation.mutate()}
      title={configured ? `AI: ${label || action}` : "Configure AI in Settings > Integrations"}
    >
      {generateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
      {label || "AI"}
    </Button>
  );
}
