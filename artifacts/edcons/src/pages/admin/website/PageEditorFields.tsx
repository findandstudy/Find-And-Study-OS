import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Braces, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BLOCK_APPEARANCE_KEYS, type BlockFieldDef } from "@/lib/website/blockTypes";
import { useI18n } from "@/hooks/use-i18n";
import { pageEditorText } from "./pageEditorCopy";
import { CMS_TEXT_VARIABLES, type CmsTextVariableValues } from "@/lib/website/cmsTextVariables";

export function BlockFieldEditor({
  fields,
  content,
  onChange,
  variableContext,
}: {
  fields: BlockFieldDef[];
  content: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  variableContext?: CmsTextVariableValues;
}) {
  const { lang } = useI18n();
  const copy = (value: string) => pageEditorText(lang, value);
  const customAppearance = content.useThemeColors === false;
  const contrastRatio = (foreground: unknown, background: unknown) => {
    const luminance = (value: unknown) => {
      const match = /^#([0-9a-f]{6})$/i.exec(String(value || ""));
      if (!match) return null;
      const components = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16) / 255).map(channel => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
      return .2126 * components[0] + .7152 * components[1] + .0722 * components[2];
    };
    const foregroundValue = luminance(foreground); const backgroundValue = luminance(background);
    return foregroundValue === null || backgroundValue === null ? null : (Math.max(foregroundValue, backgroundValue) + .05) / (Math.min(foregroundValue, backgroundValue) + .05);
  };
  const textContrast = customAppearance ? contrastRatio(content.sectionTextColor, content.sectionBackgroundColor) : null;
  const buttonContrast = customAppearance ? contrastRatio(content.sectionButtonTextColor, content.sectionButtonColor) : null;
  const variableFields = fields.filter(field => ["text", "textarea", "richtext"].includes(field.type));
  const [variableKey, setVariableKey] = useState(CMS_TEXT_VARIABLES[0].key);
  const [variableTarget, setVariableTarget] = useState(variableFields[0]?.key ?? "");
  const selectedVariable = CMS_TEXT_VARIABLES.find(item => item.key === variableKey) ?? CMS_TEXT_VARIABLES[0];
  const insertVariable = () => {
    const target = variableFields.some(field => field.key === variableTarget) ? variableTarget : variableFields[0]?.key;
    if (!target) return;
    const current = typeof content[target] === "string" ? String(content[target]) : "";
    onChange(target, `${current.trimEnd()}${current.trim() ? " " : ""}{{${selectedVariable.key}}}`);
  };
  return (
    <div className="space-y-4">
      {variableContext && variableFields.length > 0 && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
        <div><h4 className="flex items-center gap-2 text-sm font-semibold"><Braces className="h-4 w-4 text-primary" />{lang === "tr" ? "Canlı sayfa verisi ekle" : "Insert live page data"}</h4><p className="mt-1 text-xs text-muted-foreground">{lang === "tr" ? "Teknik kod yazmadan sayfa ve site bilgilerini seçili metin alanına ekleyin." : "Insert page and site information into a text field without writing technical code."}</p></div>
        <div className="grid gap-2 sm:grid-cols-2"><div className="space-y-1"><Label className="text-xs">{lang === "tr" ? "Eklenecek bilgi" : "Information to insert"}</Label><Select value={variableKey} onValueChange={setVariableKey}><SelectTrigger aria-label={lang === "tr" ? "Eklenecek bilgi" : "Information to insert"}><SelectValue /></SelectTrigger><SelectContent>{CMS_TEXT_VARIABLES.map(item => <SelectItem key={item.key} value={item.key}>{lang === "tr" ? item.labelTr : item.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label className="text-xs">{lang === "tr" ? "Hedef metin alanı" : "Target text field"}</Label><Select value={variableFields.some(field => field.key === variableTarget) ? variableTarget : variableFields[0]?.key} onValueChange={setVariableTarget}><SelectTrigger aria-label={lang === "tr" ? "Hedef metin alanı" : "Target text field"}><SelectValue /></SelectTrigger><SelectContent>{variableFields.map(field => <SelectItem key={field.key} value={field.key}>{copy(field.label)}</SelectItem>)}</SelectContent></Select></div></div>
        <div className="rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{lang === "tr" ? `${selectedVariable.labelTr}, yayınlanan sayfanın gerçek bağlamından otomatik doldurulur.` : `${selectedVariable.label} is filled automatically from the published page context.`}</p><code className="mt-2 inline-block rounded bg-muted px-2 py-1 text-xs">{`{{${selectedVariable.key}}}`}</code><Button type="button" size="sm" className="mt-3 w-full" onClick={insertVariable}>{lang === "tr" ? "Seçili alana ekle" : "Add to selected field"}</Button></div>
        <p className="text-[11px] text-muted-foreground">{lang === "tr" ? "Boş değer için yedek: {{page.title|Varsayılan başlık}}" : "Fallback for an empty value: {{page.title|Default title}}"}</p>
      </div>}
      {content.useThemeColors !== false && fields.some(field => BLOCK_APPEARANCE_KEYS.has(field.key)) && (
        <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">{copy("This section inherits its colors, width and spacing from Theme Builder. Turn off Theme Builder Colors to create a section-specific appearance.")}</p>
      )}
      {(textContrast !== null && textContrast < 4.5) || (buttonContrast !== null && buttonContrast < 4.5) ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">{copy("Accessibility warning: the selected text and background colors need more contrast before publication.")}</p>
      ) : null}
      {fields.map(field => {
        if (content.useThemeColors !== false && BLOCK_APPEARANCE_KEYS.has(field.key) && !["useThemeColors", "overlay"].includes(field.key)) return null;
        return (
        <div key={field.key} className="space-y-1.5">
          <Label className="text-xs font-medium">{copy(field.label)}</Label>
          {field.type === "text" && (
            <Input
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="h-8 text-sm"
            />
          )}
          {field.type === "textarea" && (
            <Textarea
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={3}
              className="text-sm"
            />
          )}
          {field.type === "richtext" && (
            <Textarea
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={6}
              className="text-sm font-mono"
            />
          )}
          {field.type === "html" && (
            <div className="space-y-2">
              <Textarea
                aria-label={copy(field.label)}
                value={(content[field.key] as string) || ""}
                onChange={e => onChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                rows={14}
                spellCheck={false}
                className="min-h-64 resize-y font-mono text-xs leading-5"
              />
              <p className="text-[11px] leading-4 text-muted-foreground">
                {copy("Use semantic HTML and the built-in html-content classes. Scripts, inline styles, iframes, forms and event attributes are removed before preview and publication.")}
              </p>
            </div>
          )}
          {field.type === "url" && (
            <Input
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder || "https://..."}
              className="h-8 text-sm"
            />
          )}
          {field.type === "image" && (
            <Input
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={copy("Image URL")}
              className="h-8 text-sm"
            />
          )}
          {field.type === "number" && (
            <Input
              aria-label={copy(field.label)}
              type="number"
              value={(content[field.key] as number) ?? field.defaultValue ?? ""}
              onChange={e => onChange(field.key, e.target.value ? Number(e.target.value) : "")}
              className="h-8 text-sm"
            />
          )}
          {field.type === "color" && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded border relative overflow-hidden" style={{ backgroundColor: (content[field.key] as string) || "#e5e7eb" }}>
                <input
                  aria-label={copy(field.label)}
                  type="color"
                  value={(content[field.key] as string) || "#e5e7eb"}
                  onChange={e => onChange(field.key, e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
              <Input
                aria-label={copy(field.label)}
                value={(content[field.key] as string) || ""}
                onChange={e => onChange(field.key, e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
          {field.type === "toggle" && (
            <Switch
              aria-label={copy(field.label)}
              checked={typeof content[field.key] === "boolean" ? Boolean(content[field.key]) : Boolean(field.defaultValue)}
              onCheckedChange={val => onChange(field.key, val)}
            />
          )}
          {field.type === "select" && field.options && (
            <Select value={(content[field.key] as string) || ""} onValueChange={v => onChange(field.key, v)}>
              <SelectTrigger aria-label={copy(field.label)} className="h-8 text-sm"><SelectValue placeholder={copy("Select...")} /></SelectTrigger>
              <SelectContent>
                {field.options.map(o => <SelectItem key={o.value} value={o.value}>{copy(o.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {field.type === "items" && field.itemFields && (
            <ItemsEditor
              items={(content[field.key] as Record<string, unknown>[]) || []}
              itemFields={field.itemFields}
              onChange={newItems => onChange(field.key, newItems)}
            />
          )}
        </div>
      );})}
    </div>
  );
}

function ItemsEditor({
  items,
  itemFields,
  onChange,
}: {
  items: Record<string, unknown>[];
  itemFields: BlockFieldDef[];
  onChange: (items: Record<string, unknown>[]) => void;
}) {
  const { lang } = useI18n();
  const copy = (value: string) => pageEditorText(lang, value);
  const addItem = () => {
    const defaults: Record<string, unknown> = {};
    itemFields.forEach(f => { defaults[f.key] = f.defaultValue ?? ""; });
    onChange([...items, defaults]);
  };

  const removeItem = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, key: string, value: unknown) => {
    onChange(items.map((item, i) => i === idx ? { ...item, [key]: value } : item));
  };

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <Card key={idx} className="bg-secondary/30">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{copy("Item")} {idx + 1}</span>
              <Button aria-label={`${copy("Remove item")} ${idx + 1}`} variant="ghost" size="icon" className="h-5 w-5 text-red-500" onClick={() => removeItem(idx)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            {itemFields.map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">{copy(f.label)}</Label>
                {(f.type === "text" || f.type === "url" || f.type === "image") && (
                  <Input
                    aria-label={`${copy(f.label)} ${idx + 1}`}
                    value={(item[f.key] as string) || ""}
                    onChange={e => updateItem(idx, f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="h-7 text-xs"
                  />
                )}
                {f.type === "textarea" && (
                  <Textarea
                    aria-label={`${copy(f.label)} ${idx + 1}`}
                    value={(item[f.key] as string) || ""}
                    onChange={e => updateItem(idx, f.key, e.target.value)}
                    rows={2}
                    className="text-xs"
                  />
                )}
                {f.type === "number" && (
                  <Input
                    aria-label={`${copy(f.label)} ${idx + 1}`}
                    type="number"
                    value={(item[f.key] as number) ?? ""}
                    onChange={e => updateItem(idx, f.key, Number(e.target.value))}
                    className="h-7 text-xs"
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={addItem}>
        <Plus className="w-3 h-3 mr-1" /> {copy("Add Item")}
      </Button>
    </div>
  );
}

export function GlobalBlockSelector({
  content,
  onChange,
}: {
  content: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { data: globalComponents = [] } = useQuery<{ id: number; name: string; slug: string; componentType: string; isActive: boolean }[]>({
    queryKey: ["website-global-components"],
    queryFn: () => customFetch("/api/website/global-components"),
  });

  const activeComponents = globalComponents.filter(c => c.isActive);
  const selectedId = content.globalComponentId as number | null;
  const selectedComp = activeComponents.find(c => c.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Global Component</Label>
        {activeComponents.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No active global components. Create one in Website &gt; Global Components first.
          </p>
        ) : (
          <Select
            value={selectedId ? String(selectedId) : ""}
            onValueChange={v => {
              const comp = activeComponents.find(c => c.id === Number(v));
              if (comp) {
                onChange("globalComponentId", comp.id);
                onChange("globalComponentSlug", comp.slug);
              }
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a component..." />
            </SelectTrigger>
            <SelectContent>
              {activeComponents.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name} ({c.componentType.replace(/_/g, " ")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {selectedComp && (
        <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
          <p className="text-xs font-medium text-purple-700 dark:text-purple-300">{selectedComp.name}</p>
          <p className="text-[10px] text-purple-500 dark:text-purple-400 mt-0.5">
            Type: {selectedComp.componentType.replace(/_/g, " ")} | Slug: {selectedComp.slug}
          </p>
        </div>
      )}
    </div>
  );
}
