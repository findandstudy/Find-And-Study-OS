import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { type DetailLayout } from "@/lib/website/detailLayoutContract";
type Entry = { pageId: number | null; digest: string | null; updatedAt: string | null; status: string; layout: DetailLayout };

export default function DetailTemplates() {
  const client = useQueryClient();
  const [edits, setEdits] = useState<Record<string, DetailLayout>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [approved, setApproved] = useState(false);
  const query = useQuery<Entry[]>({ queryKey: ["detail-layouts"], queryFn: () => customFetch("/api/website/detail-layouts"), refetchOnWindowFocus: false });
  const refresh = async () => { setApproved(false); setSelected([]); setEdits({}); await client.invalidateQueries({ queryKey: ["detail-layouts"] }); };
  const save = useMutation({ mutationFn: (entry: Entry) => customFetch("/api/website/detail-layouts/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: entry.updatedAt, layout: edits[entry.layout.kind] ?? entry.layout }) }), onSuccess: async (_result, entry) => {
    setApproved(false); setSelected([]);
    setEdits(old => { const next = { ...old }; delete next[entry.layout.kind]; return next; });
    await client.invalidateQueries({ queryKey: ["detail-layouts"] });
  } });
  const publish = useMutation({ mutationFn: () => customFetch("/api/website/detail-layouts/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved, selections: query.data?.filter(e => e.pageId && selected.includes(e.pageId)).map(e => ({ pageId: e.pageId, digest: e.digest })) }) }), onSuccess: refresh });
  const busy = save.isPending || publish.isPending;
  const change = (layout: DetailLayout) => { setApproved(false); setSelected([]); setEdits(old => ({ ...old, [layout.kind]: layout })); };
  return <section className="space-y-4 rounded-xl border p-4" aria-labelledby="detail-templates-title">
    <h2 id="detail-templates-title" className="text-xl font-semibold">Shared detail templates</h2>
    <p className="text-sm text-muted-foreground">Layouts reuse current catalogue data, SEO and Apply. Save a draft, then have a different administrator review and publish. No catalogue records are published by this action.</p>
    {query.isLoading && <p role="status">Loading templates…</p>}
    {query.isError && <p role="alert">Could not load templates. <Button variant="outline" onClick={() => query.refetch()}>Retry</Button></p>}
    <div className="grid gap-4 md:grid-cols-2">{query.data?.map(entry => {
      const layout = edits[entry.layout.kind] ?? entry.layout;
      return <fieldset key={layout.kind} disabled={busy} className="space-y-3 rounded-lg border p-4">
        <legend className="px-2 font-semibold capitalize">{layout.kind} · {entry.status}</legend>
        {layout.sections.map((section, index) => <div key={section} className="flex flex-wrap items-center gap-2">
          <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={!layout.hidden.includes(section)} disabled={["hero", "navigation", "overview"].includes(section)} onChange={e => change({ ...layout, hidden: e.target.checked ? layout.hidden.filter(x => x !== section) : [...layout.hidden, section] })} />{section}</label>
          <Button size="sm" variant="outline" aria-label={`Move ${section} up in ${layout.kind}`} disabled={index <= (layout.sections.includes("navigation") ? 3 : 2)} onClick={() => { const sections = [...layout.sections]; [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]]; change({ ...layout, sections }); }}>↑</Button>
        </div>)}
        <Button variant="outline" onClick={() => save.mutate(entry)}>Save layout draft</Button>
        {entry.pageId && entry.status === "draft" && !Object.keys(edits).length && <label className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(entry.pageId)} onChange={e => { setApproved(false); setSelected(old => e.target.checked ? [...old, entry.pageId!] : old.filter(id => id !== entry.pageId)); }} />Include saved draft in review</label>}
      </fieldset>;
    })}</div>
    {!!selected.length && <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">Review {selected.length} saved templates</h3>
      <p className="text-sm">This affects every public detail page of the selected types. A different administrator must approve.</p>
      {query.data?.filter(e => e.pageId && selected.includes(e.pageId)).map(e => <p key={e.pageId} className="break-words text-sm">{e.layout.kind}: {e.layout.sections.filter(s => !e.layout.hidden.includes(s)).join(" → ")}; hidden: {e.layout.hidden.join(", ") || "none"}</p>)}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />I reviewed these exact saved layouts and approve publication.</label>
      <Button disabled={!approved || busy} onClick={() => publish.mutate()}>Publish approved layouts</Button>
    </div>}
    {(save.isError || publish.isError) && <p role="alert" className="text-destructive">Not completed. Publication requires a different administrator; changed drafts must be reviewed again. <Button variant="outline" onClick={refresh}>Reload drafts</Button></p>}
    {publish.isSuccess && <p role="status">Approved layouts published.</p>}
  </section>;
}
