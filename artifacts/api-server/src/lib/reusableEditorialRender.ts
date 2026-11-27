/** Published editorial presets share the same independent fields as the client renderer. */
export function renderReusableEditorial(
  content: Record<string, unknown>,
  helpers: { escape: (v: string) => string; image: (v: unknown) => string | null; url: (v: unknown) => string | null },
): string | null {
  const variant = String(content.variant || "");
  if (!["about-banner", "about-intro", "about-approach", "about-why", "about-pillars", "about-panorama", "about-enquiry", "about-faq", "about-end"].includes(variant)) return null;
  const { escape: e, image, url } = helpers;
  const t = (v: unknown) => e(typeof v === "string" ? v.slice(0, 20000) : "");
  const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object").slice(0, 50) : [];
  const img = (src: unknown, alt: unknown = "", cls = "") => { const value = image(src); return value ? `<img src="${e(value)}" alt="${t(alt)}" class="${cls}" loading="lazy"/>` : ""; };
  const action = (href: unknown, label: unknown) => { const value = url(href); return value && label ? `<a class="ar-button" href="${e(value)}">${t(label)} ↗</a>` : ""; };
  const heading = `<span class="ar-kicker">${t(content.eyebrow)}</span><h2>${t(content.title)}</h2>${content.subtitle ? `<p>${t(content.subtitle)}</p>` : ""}`;
  let body = "";
  if (variant === "about-banner") {
    const cap=(v:unknown)=>{const s=typeof v==="string"?v.trim():"";return t(s?s[0].toLocaleUpperCase()+s.slice(1):s);};
    const background=image(content.backgroundImage),home=url(content.breadcrumbUrl);
    body=`<section class="public-page-header"${background?` style="background-image:linear-gradient(#101828a6,#101828a6),url(&quot;${e(background)}&quot;)"`:""}><nav aria-label="Breadcrumb"><span>${home?`<a href="${e(home)}">${cap(content.breadcrumbLabel)}</a>`:cap(content.breadcrumbLabel)} ›</span><span aria-current="page">${cap(content.title)}</span></nav><h1>${cap(content.title)}</h1></section>`;
  }
  if (variant === "about-intro") body = `<section class="ar-section ar-intro"><div class="ar-container ar-two-col"><div class="ar-intro-visual">${img(content.imageUrl, content.altText, "ar-photo")}<div class="ar-photo-caption"><h3>${t(content.captionTitle)}</h3><p>${t(content.captionBody)}</p></div></div><div>${heading}<p>${t(content.body)}</p><div class="ar-intro-detail"><div><h3>${t(content.detailTitle)}</h3><p>${t(content.detailBody)}</p></div>${img(content.secondaryImage, content.secondaryAltText)}</div>${action(content.ctaUrl, content.ctaLabel)}</div></div></section>`;
  if (variant === "about-approach") body = `<section class="ar-section ar-approach"><div class="ar-container ar-two-col"><div>${heading}${action(content.ctaUrl, content.ctaLabel)}</div><div class="ar-approach-cards">${rows(content.cards).map(c => `<article><h3>${t(c.title)}</h3><p>${t(c.description)}</p></article>`).join("")}</div></div><div class="ar-container ar-strip"><p>${t(content.stripText)} ${action(content.stripUrl, content.stripLabel)}</p></div></section>`;
  if (variant === "about-why") body = `<section class="ar-section ar-why"><div class="ar-container ar-why-layout"><div class="ar-why-visual">${img(content.imageUrl, content.altText)}</div><div>${heading}<div class="ar-numbered">${rows(content.steps).map((c, i) => `<article><span>${t(c.number || String(i + 1).padStart(2,"0"))}</span><div><h3>${t(c.title)}</h3><p>${t(c.description)}</p></div></article>`).join("")}</div></div></div></section>`;
  if (variant === "about-pillars") body = `<section class="ar-stat-band"><div class="ar-container">${rows(content.items).map(c => `<div><strong>${t(c.value)}</strong><span>${t(c.label)}</span></div>`).join("")}</div></section>`;
  if (variant === "about-panorama") body = `<section class="ar-panorama">${img(content.imageUrl, content.altText)}${action(content.ctaUrl, content.ctaLabel)}</section>`;
  if (variant === "about-enquiry") body = `<section class="ar-section ar-enquiry"><div class="ar-container ar-two-col"><div>${heading}<ul class="ar-check-list">${rows(content.items).map(c => `<li>${t(c.title)}</li>`).join("")}</ul></div><div class="ar-form"><h3>${t(content.formTitle)}</h3></div></div></section>`;
  if (variant === "about-faq") body = `<section class="ar-section ar-faq"><div class="ar-container ar-two-col"><div>${heading}${img(content.imageUrl, content.altText, "ar-faq-image")}</div><div class="ar-faq-list">${rows(content.items).map(c => `<details><summary>${t(c.question)}</summary><p>${t(c.answer)}</p></details>`).join("")}</div></div></section>`;
  if (variant === "about-end") body = `<section class="ar-section ar-end"><div class="ar-container">${heading}<div class="ar-actions">${action(content.ctaUrl, content.ctaLabel)}${action(content.secondaryUrl, content.secondaryLabel)}</div></div></section>`;
  return `<div class="about-reference cms-independent-editorial" data-section-design="${variant}">${body}</div>`;
}
