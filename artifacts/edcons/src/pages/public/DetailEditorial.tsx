import React, { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import { localDetailPath, type DetailTuition, detailMoney, detailCopy } from "./detailPresentation";

/** Decorative, deliberately non-photographic brand artwork. Not a campus. */
export function DetailArtwork() {
  return <div className="detail-art" aria-hidden="true"><span className="detail-orbit detail-orbit-one" /><span className="detail-orbit detail-orbit-two" /><span className="detail-orbit detail-orbit-three" /><span className="detail-art-mark">&amp;</span><span className="detail-art-caption">FIND AND STUDY</span></div>;
}

export function DetailImage({ src, alt, className = "" }: { src: string | null | undefined; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src || !/^(?:https?:\/\/|\/(?!\/))/.test(src)) return <DetailArtwork />;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(src)} loading="lazy" decoding="async" />;
}

export function DetailBreadcrumbs({ items, label }: { items: { label: string; path?: string | null }[]; label: string }) {
  return <nav className="detail-breadcrumbs" aria-label={label}><ol>{items.filter(item => item.label).map((item, i) => <li key={`${item.label}-${i}`}>{localDetailPath(item.path) ? <Link href={localDetailPath(item.path)!}>{item.label}</Link> : <span aria-current={i === items.length - 1 ? "page" : undefined}>{item.label}</span>}</li>)}</ol></nav>;
}

export function DetailHeading({ number, eyebrow, title, children }: { number: string; eyebrow: string; title: string; children?: ReactNode }) {
  return <div className="detail-section-heading"><span className="detail-section-number" aria-hidden="true">{number}</span><div><p className="detail-eyebrow">{eyebrow}</p><h2>{title}</h2>{children}</div></div>;
}

export function DetailFacts({ items }: { items: { label: string; value?: ReactNode }[] }) {
  return <dl className="detail-facts">{items.filter(item => item.value !== null && item.value !== undefined && item.value !== "").map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

export function DetailPrice({ tuition, locale, verifiedLabel }: { tuition: DetailTuition | null; locale: string; verifiedLabel: string }) {
  const copy = detailCopy(locale);
  const price = tuition ? detailMoney(tuition.amount, tuition.currency, locale) : null;
  return <><p className="detail-price">{price && tuition?.isFrom ? `${copy.from} ${price}` : price || copy.confirmPrice}</p>{price && tuition && <p className={`detail-provenance ${tuition.verified ? "is-verified" : ""}`}>{tuition.verified ? verifiedLabel : copy.legacyPrice}{tuition.frequency ? ` · ${tuition.frequency.replaceAll("_", " ").toLowerCase()}` : ""}</p>}</>;
}

export function DetailCard({ href, eyebrow, title, children, index = 0 }: { href: string; eyebrow?: string | null; title: string; children?: ReactNode; index?: number }) {
  return <Link href={href} className="detail-catalog-card"><span className="detail-card-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div>{eyebrow && <p className="detail-eyebrow">{eyebrow}</p>}<h3>{title}</h3>{children}</div><ArrowUpRight aria-hidden="true" className="detail-card-arrow" /></Link>;
}
