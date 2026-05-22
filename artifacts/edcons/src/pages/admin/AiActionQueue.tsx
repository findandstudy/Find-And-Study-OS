import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListChecks } from "lucide-react";

type ActionItem = {
  id: number;
  personaId: number;
  personaName: string | null;
  runId: number | null;
  actionType: string;
  preview: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewerEmail: string | null;
};

export default function AiActionQueue() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await customFetch<{ actions: ActionItem[] }>(
          "/api/ai-personas/queue/actions",
        );
        setItems(data.actions);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pending = items.filter((i) => i.status === "pending_approval");
  const history = items.filter((i) => i.status !== "pending_approval");

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ListChecks className="h-6 w-6 text-indigo-500" /> AI Action Queue
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Operatör personalarının ürettiği yan etkili aksiyonlar bu kuyruğa düşer. Faz 1'de iskelet
          görünüyor; Onayla/Reddet akışı Faz 2'de devreye alınacak.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onay bekleyenler ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!loading && pending.length === 0 && (
            <div className="text-sm text-muted-foreground">Bekleyen aksiyon yok.</div>
          )}
          {pending.map((a) => (
            <div key={a.id} className="border rounded p-3 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">{a.actionType}</Badge>
                  <span className="text-muted-foreground">
                    {a.personaName ?? `persona #${a.personaId}`} · run #{a.runId ?? "—"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled title="Faz 2'de aktif">
                    Reddet
                  </Button>
                  <Button size="sm" disabled title="Faz 2'de aktif">
                    Onayla
                  </Button>
                </div>
              </div>
              {a.preview && (
                <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap max-h-48 overflow-auto">
                  {a.preview}
                </pre>
              )}
              <div className="text-xs text-muted-foreground">
                {new Date(a.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Geçmiş ({history.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 && (
            <div className="text-sm text-muted-foreground">Geçmiş kayıt yok.</div>
          )}
          {history.map((a) => (
            <div
              key={a.id}
              className="border rounded p-2 text-sm flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{a.status}</Badge>
                <span>{a.actionType}</span>
                <span className="text-muted-foreground">
                  · {a.personaName ?? `#${a.personaId}`}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {a.reviewerEmail ?? ""} {a.reviewedAt ? new Date(a.reviewedAt).toLocaleString() : ""}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
