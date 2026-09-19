import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { customFetch } from "@workspace/api-client-react";
import { defaultDetailLayout, parseDetailLayout, type DetailLayoutKind } from "@/lib/website/detailLayoutContract";
import "./detailEditorial.css";

/** Reorders the existing React sections; catalogue facts and Apply components stay untouched. */
export function DetailLayout({ kind, children }: { kind: DetailLayoutKind; children: ReactNode }) {
  const initial = () => {
    try { const parsed = parseDetailLayout(JSON.parse(document.getElementById("public-detail-layout")?.textContent ?? "null")); if (parsed?.kind === kind) return parsed; } catch { /* Built-in safe layout. */ }
    return defaultDetailLayout(kind);
  };
  const [layout, setLayout] = useState(initial);
  const root = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLayout(initial());
    customFetch(`/api/public/web/detail-layouts/${kind}`, { signal: controller.signal })
      .then(value => { const parsed = parseDetailLayout(value); if (parsed?.kind === kind) setLayout(parsed); })
      .catch(() => { /* Safe built-in layout on unavailable or invalid configuration. */ });
    return () => controller.abort();
  }, [kind]);
  // The local chapter bar tracks only rendered sections. CMS-hidden sections
  // cannot become active links, and this never changes the canonical route.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const ids = Array.from(element.querySelectorAll<HTMLAnchorElement>('.detail-nav a[href^="#"]'))
      .map(link => link.getAttribute("href")!.slice(1));
    const sections = Array.from(element.querySelectorAll<HTMLElement>("[data-detail-section][id]"))
      .filter(section => ids.includes(section.id));
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = (element.querySelector(".detail-nav")?.getBoundingClientRect().bottom ?? 140) + 24;
      const current = [...sections].reverse().find(section => section.getBoundingClientRect().top <= top) || sections[0];
      setActiveSection(current?.id || "");
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [kind, layout, children]);
  const cleanLinks = (node: ReactNode, insideNavigation = false): ReactNode => {
    if (!isValidElement<{ href?: string; children?: ReactNode; "data-detail-section"?: string; "aria-current"?: "location" }>(node)) return node;
    if (node.type === "a" && node.props.href?.startsWith("#") && layout.hidden.includes(node.props.href.slice(1))) return null;
    const inNavigation = insideNavigation || node.props["data-detail-section"] === "navigation";
    const props = inNavigation && node.type === "a" && node.props.href?.startsWith("#")
      ? { "aria-current": node.props.href.slice(1) === activeSection ? "location" as const : undefined } : {};
    let nested = node.props.children ? Children.toArray(node.props.children).map(child => cleanLinks(child, inNavigation)).filter(Boolean) : null;
    if (inNavigation && nested?.every(child => isValidElement<{ href?: string }>(child) && child.props.href?.startsWith("#"))) {
      nested.sort((a, b) => {
        const index = (child: ReactNode) => isValidElement<{ href?: string }>(child) ? layout.sections.indexOf(child.props.href!.slice(1)) : -1;
        return index(a) - index(b);
      });
    }
    return cloneElement(node, props, nested ?? node.props.children);
  };
  const nodes = Children.toArray(children).map(child => cleanLinks(child)).filter(node => !isValidElement(node) || !layout.hidden.includes((node.props as Record<string, string>)["data-detail-section"]))
    .sort((a, b) => {
      const order = (node: ReactNode) => { const index = isValidElement(node) ? layout.sections.indexOf((node.props as Record<string, string>)["data-detail-section"]) : -1; return index < 0 ? layout.sections.length : index; };
      return order(a) - order(b);
    });
  return <div ref={root} className={`public-detail detail-${kind}`}>{nodes}</div>;
}
