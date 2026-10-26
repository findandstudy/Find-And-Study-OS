import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, useContext, type CSSProperties, type ReactNode } from "react";
import { DetailPreviewContext } from "./DetailPreviewContext";
import { customFetch } from "@workspace/api-client-react";
import { defaultDetailLayout, parseDetailLayout, type DetailLayoutKind, type DetailSectionPresentation } from "@/lib/website/detailLayoutContract";
import "./detailEditorial.css";

const previewSectionLabels: Record<string, string> = {
  gallery: "Image gallery", highlights: "Highlights", cautions: "Things to consider", curriculum: "Curriculum",
  education: "Education", admission: "Admission information", requirements: "Requirements", scholarships: "Scholarships",
  living: "Living costs", climate: "Weather and climate", transport: "Transport", campus: "Campus", housing: "Housing",
  visa: "Visa and calendar", services: "Student services", support: "Student support", intakeGuide: "Intakes and calendar",
  studentStory: "Student experience", reviews: "Student reviews", recognition: "Recognition and outcomes",
  faq: "Frequently asked questions", applyGuide: "Application guide",
};

function PreviewEmptySection({ layoutKey }: { layoutKey: string }) {
  const key = layoutKey.replace(/^editorial-/, "");
  const title = previewSectionLabels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
  const message = "No reviewed content has been added for this record yet. This section is part of the shared template and can be completed in the CMS editor.";
  return <section data-detail-section={layoutKey} id={layoutKey} className={`detail-section detail-editorial-section detail-preview-empty is-${key}`} aria-label={`${title} preview placeholder`}>
    <div className="detail-wrap detail-editorial-content">
      <div className="detail-editorial-heading"><span aria-hidden="true">+</span><h2>{title}</h2></div>
      <p className="detail-prose detail-editorial-intro">{message}</p>
      {key === "climate" && <div className="detail-climate-ribbon" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <article key={index}><span>Month {index + 1}</span><b>—</b></article>)}</div>}
      {key === "housing" && <div className="detail-housing-strip" aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <article key={index}><div><span>0{index + 1}</span><h3>Housing option</h3><p>Awaiting reviewed accommodation data.</p></div></article>)}</div>}
      {(key === "reviews" || key === "studentStory") && <div className="detail-review-grid" aria-hidden="true"><div /><div><blockquote><p>“Reviewed student experience will appear here.”</p><cite>Awaiting verified first-party review</cite></blockquote></div></div>}
    </div>
  </section>;
}

function overlayRgba(colour: string | undefined, opacity: number | undefined) {
  if (!colour || opacity === undefined) return null;
  const value = colour.slice(1);
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${opacity / 100})`;
}

export function detailSectionPresentationStyle(setting: DetailSectionPresentation): CSSProperties {
  const overlay = overlayRgba(setting.overlayColor, setting.overlayOpacity);
  const image = setting.backgroundImageUrl ? `url(${JSON.stringify(setting.backgroundImageUrl)})` : null;
  return {
    backgroundColor: setting.backgroundColor,
    color: setting.textColor,
    ...(image || overlay ? { backgroundImage: [overlay ? `linear-gradient(${overlay}, ${overlay})` : null, image].filter(Boolean).join(", ") } : {}),
    backgroundSize: setting.backgroundImageFit,
    backgroundPosition: setting.backgroundImagePosition,
    backgroundRepeat: setting.backgroundImageRepeat,
    "--detail-section-accent": setting.accentColor,
    "--detail-accent": setting.accentColor,
  } as CSSProperties;
}

export function detailSectionPresentationCss(key: string, setting: DetailSectionPresentation): string {
  if (!/^[a-zA-Z-]+$/.test(key)) return "";
  const overlay = overlayRgba(setting.overlayColor, setting.overlayOpacity);
  const image = setting.backgroundImageUrl ? `url(${JSON.stringify(setting.backgroundImageUrl).replace(/</g, "\\3c ")})` : null;
  const declarations = [
    setting.backgroundColor && `background-color:${setting.backgroundColor}`,
    setting.textColor && `color:${setting.textColor}`,
    setting.accentColor && `--detail-section-accent:${setting.accentColor};--detail-accent:${setting.accentColor}`,
    (image || overlay) && `background-image:${[overlay ? `linear-gradient(${overlay},${overlay})` : null, image].filter(Boolean).join(",")}`,
    setting.backgroundImageFit && `background-size:${setting.backgroundImageFit}`,
    setting.backgroundImagePosition && `background-position:${setting.backgroundImagePosition}`,
    setting.backgroundImageRepeat && `background-repeat:${setting.backgroundImageRepeat}`,
  ].filter(Boolean);
  return declarations.length ? `.public-detail>[data-detail-section="${key}"]{${declarations.join(";")}}` : "";
}

/** Reorders the existing React sections; catalogue facts and Apply components stay untouched. */
export function DetailLayout({ kind, children, sectionOrder, sectionPresentation }: { kind: DetailLayoutKind; children: ReactNode; sectionOrder?: readonly string[]; sectionPresentation?: Record<string, DetailSectionPresentation> }) {
  const preview = useContext(DetailPreviewContext);
  const templatePreview = !!preview || (import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("templatePreview") === "1");
  const embedded = () => {
    try { const parsed = parseDetailLayout(JSON.parse(document.getElementById("public-detail-layout")?.textContent ?? "null")); if (parsed?.kind === kind) return parsed; } catch { /* Built-in safe layout. */ }
    return null;
  };
  const [layout, setLayout] = useState(() => preview?.layout ?? embedded() ?? defaultDetailLayout(kind));
  const effectiveLayout = useMemo(
    () => sectionOrder?.length ? { ...layout, sections: [...sectionOrder] } : layout,
    [layout, sectionOrder],
  );
  const appearanceCss = useMemo(() => effectiveLayout.sections
    .filter(key => !effectiveLayout.hidden.includes(key))
    .map(key => detailSectionPresentationCss(key, { ...(effectiveLayout.presentation[key] ?? {}), ...(sectionPresentation?.[key] ?? {}) }))
    .filter(Boolean)
    .join(""), [effectiveLayout, sectionPresentation]);
  const root = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState("");
  useEffect(() => {
    if (preview) return;
    const serverLayout = embedded();
    if (serverLayout) {
      setLayout(serverLayout);
      return;
    }
    const controller = new AbortController();
    setLayout(defaultDetailLayout(kind));
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
  }, [kind, effectiveLayout, children]);
  const cleanLinks = (node: ReactNode, insideNavigation = false): ReactNode => {
    if (!isValidElement<{ href?: string; children?: ReactNode; "data-detail-section"?: string; "aria-current"?: "location" }>(node)) return node;
    if (node.type === "a" && node.props.href?.startsWith("#") && effectiveLayout.hidden.includes(node.props.href.slice(1))) return null;
    const inNavigation = insideNavigation || node.props["data-detail-section"] === "navigation";
    const props = inNavigation && node.type === "a" && node.props.href?.startsWith("#")
      ? { "aria-current": node.props.href.slice(1) === activeSection ? "location" as const : undefined } : {};
    let nested = node.props.children ? Children.toArray(node.props.children).map(child => cleanLinks(child, inNavigation)).filter(Boolean) : null;
    if (inNavigation && nested?.every(child => isValidElement<{ href?: string }>(child) && child.props.href?.startsWith("#"))) {
      nested.sort((a, b) => {
        const index = (child: ReactNode) => isValidElement<{ href?: string }>(child) ? effectiveLayout.sections.indexOf(child.props.href!.slice(1)) : -1;
        return index(a) - index(b);
      });
    }
    return cloneElement(node, props, nested ?? node.props.children);
  };
  const applyPresentation = (node: ReactNode): ReactNode => {
    if (!isValidElement<Record<string, unknown>>(node)) return node;
    const key = node.props["data-detail-section"];
    if (typeof key !== "string") return node;
    const setting = { ...(effectiveLayout.presentation[key] ?? {}), ...(sectionPresentation?.[key] ?? {}) };
    if (!Object.keys(setting).length) return node;
    return cloneElement(node, {
      "data-template-tone": setting.tone,
      "data-template-width": setting.width,
      "data-template-spacing": setting.spacing,
      "data-template-align": setting.align,
      "data-template-min-height": setting.minHeight,
      style: { ...((node.props.style as CSSProperties | undefined) ?? {}), ...detailSectionPresentationStyle(setting) },
    });
  };
  const sourceNodes = Children.toArray(children).map(child => applyPresentation(cleanLinks(child))).filter(node => !isValidElement(node) || !effectiveLayout.hidden.includes((node.props as Record<string, string>)["data-detail-section"]));
  const renderedKeys = new Set(sourceNodes.flatMap(node => isValidElement(node) && typeof (node.props as Record<string, unknown>)["data-detail-section"] === "string" ? [(node.props as Record<string, string>)["data-detail-section"]] : []));
  const previewPlaceholders = templatePreview ? effectiveLayout.sections.filter(section => section.startsWith("editorial-") && !effectiveLayout.hidden.includes(section) && !renderedKeys.has(section)).map(section => <PreviewEmptySection key={section} layoutKey={section} />) : [];
  const nodes = [...sourceNodes, ...previewPlaceholders]
    .sort((a, b) => {
      const order = (node: ReactNode) => { const index = isValidElement(node) ? effectiveLayout.sections.indexOf((node.props as Record<string, string>)["data-detail-section"]) : -1; return index < 0 ? effectiveLayout.sections.length : index; };
      return order(a) - order(b);
    });
  const nonce = typeof document !== "undefined" ? document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content : undefined;
  return <div ref={root} className={`public-detail detail-${kind}`}>{appearanceCss && <style nonce={nonce} data-detail-appearance>{appearanceCss}</style>}{nodes}</div>;
}
