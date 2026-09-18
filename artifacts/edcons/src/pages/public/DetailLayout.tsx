import { Children, cloneElement, isValidElement, useEffect, useState, type ReactNode } from "react";
import { customFetch } from "@workspace/api-client-react";
import { defaultDetailLayout, parseDetailLayout, type DetailLayoutKind } from "@/lib/website/detailLayoutContract";

/** Reorders the existing React sections; catalogue facts and Apply components stay untouched. */
export function DetailLayout({ kind, children }: { kind: DetailLayoutKind; children: ReactNode }) {
  const initial = () => {
    try { const parsed = parseDetailLayout(JSON.parse(document.getElementById("public-detail-layout")?.textContent ?? "null")); if (parsed?.kind === kind) return parsed; } catch { /* Built-in safe layout. */ }
    return defaultDetailLayout(kind);
  };
  const [layout, setLayout] = useState(initial);
  useEffect(() => {
    const controller = new AbortController();
    setLayout(initial());
    customFetch(`/api/public/web/detail-layouts/${kind}`, { signal: controller.signal })
      .then(value => { const parsed = parseDetailLayout(value); if (parsed?.kind === kind) setLayout(parsed); })
      .catch(() => { /* Safe built-in layout on unavailable or invalid configuration. */ });
    return () => controller.abort();
  }, [kind]);
  const cleanLinks = (node: ReactNode): ReactNode => {
    if (!isValidElement<{ href?: string; children?: ReactNode }>(node)) return node;
    if (node.type === "a" && node.props.href?.startsWith("#") && layout.hidden.includes(node.props.href.slice(1))) return null;
    return node.props.children ? cloneElement(node, {}, Children.map(node.props.children, cleanLinks)) : node;
  };
  const nodes = Children.toArray(children).map(cleanLinks).filter(node => !isValidElement(node) || !layout.hidden.includes((node.props as Record<string, string>)["data-detail-section"]))
    .sort((a, b) => {
      const order = (node: ReactNode) => isValidElement(node) ? layout.sections.indexOf((node.props as Record<string, string>)["data-detail-section"]) : -1;
      return order(a) - order(b);
    });
  return <>{nodes}</>;
}
