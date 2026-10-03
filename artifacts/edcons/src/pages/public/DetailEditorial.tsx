import React, { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowUpRight, BookOpen, Building2, MapPin } from "lucide-react";
import { localDetailPath, type DetailTuition, detailMoney, detailCopy } from "./detailPresentation";

/** A missing catalogue photograph leaves no fake campus or empty media frame. */
export function DetailImage({ src, alt, className = "", priority = false }: { src: string | null | undefined; alt: string; className?: string; priority?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src || !/^(?:https?:\/\/|\/(?!\/))/.test(src)) return null;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(src)} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" />;
}

export function DetailIdentity({ src, name, kind = "university" }: { src?: string | null; name: string; kind?: "university" | "city" | "program" }) {
  const [failed, setFailed] = useState<string | null>(null);
  const Icon = kind === "city" ? MapPin : kind === "program" ? BookOpen : Building2;
  return <span className={`detail-card-identity is-${kind}`} aria-hidden="true">
    {src && failed !== src && /^(?:https?:\/\/|\/(?!\/))/.test(src)
      ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
      : <Icon size={24} strokeWidth={1.6} />}
  </span>;
}

export function DetailBreadcrumbs({ items, label }: { items: { label: string; path?: string | null }[]; label: string }) {
  const visibleItems = items.filter(item => item.label);
  return <nav className="detail-breadcrumbs" aria-label={label}><ol>{visibleItems.map((item, i) => <li key={`${item.label}-${i}`}>{localDetailPath(item.path) ? <Link href={localDetailPath(item.path)!}>{item.label}</Link> : <span aria-current={i === visibleItems.length - 1 ? "page" : undefined}>{item.label}</span>}</li>)}</ol></nav>;
}

export function DetailHeading({ number, eyebrow, title, children }: { number: string; eyebrow: string; title: string; children?: ReactNode }) {
  return <div className="detail-section-heading"><span className="detail-section-number" aria-hidden="true">{number}</span><div><p className="detail-eyebrow">{eyebrow}</p><h2>{title}</h2>{children}</div></div>;
}

export function DetailFacts({ items }: { items: { label: string; value?: ReactNode; icon?: ReactNode }[] }) {
  const visibleItems = items.filter(item => item.value !== null && item.value !== undefined && item.value !== "");
  if (visibleItems.length === 0) return null;
  return <dl className="detail-facts">{visibleItems.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.icon && <span className="detail-fact-icon" aria-hidden="true">{item.icon}</span>}{item.label}</dt><dd><bdi>{item.value}</bdi></dd></div>)}</dl>;
}

export function DetailPrice({ tuition, locale, verifiedLabel }: { tuition: DetailTuition | null; locale: string; verifiedLabel: string }) {
  const copy = detailCopy(locale);
  const price = tuition ? detailMoney(tuition.amount, tuition.currency, locale) : null;
  return <><p className={`detail-price${price ? "" : " is-unavailable"}`}>{price && tuition?.isFrom ? `${copy.from} ${price}` : price || copy.confirmPrice}</p>{price && tuition && <p className={`detail-provenance ${tuition.verified ? "is-verified" : ""}`}>{tuition.verified ? verifiedLabel : copy.legacyPrice}{tuition.frequency ? ` · ${tuition.frequency.replaceAll("_", " ").toLowerCase()}` : ""}</p>}</>;
}

export function DetailCard({ href, eyebrow, title, children, logoUrl, kind = "program" }: { href: string; eyebrow?: string | null; title: string; children?: ReactNode; index?: number; logoUrl?: string | null; kind?: "university" | "city" | "program" }) {
  return <Link href={href} className={`detail-catalog-card is-${kind}`}><div className="detail-card-top"><DetailIdentity src={logoUrl} name={title} kind={kind} /><ArrowUpRight aria-hidden="true" className="detail-card-arrow" /></div><div className="detail-card-content">{eyebrow && <p className="detail-eyebrow">{eyebrow}</p>}<h3>{title}</h3>{children}</div></Link>;
}
