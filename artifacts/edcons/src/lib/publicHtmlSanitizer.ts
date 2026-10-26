import DOMPurify from "isomorphic-dompurify";

const PUBLIC_RICH_TEXT_TAGS = [
  "p", "br", "strong", "em", "b", "i", "u", "a", "ul", "ol", "li",
  "h2", "h3", "h4", "blockquote", "code", "pre", "span", "hr",
];

const PUBLIC_HTML_CONTENT_TAGS = [
  ...PUBLIC_RICH_TEXT_TAGS,
  "div", "section", "article", "aside", "header", "footer", "main", "nav",
  "h5", "h6", "figure", "figcaption", "img", "table", "thead", "tbody",
  "tfoot", "tr", "th", "td", "caption", "dl", "dt", "dd", "details", "summary",
];

/**
 * Public CMS and guide prose share one deliberately small HTML contract.
 * Links remain in the current tab: removing `target` also removes the reverse
 * tabnabbing surface instead of trusting author-supplied `rel` values.
 */
export function sanitizePublicRichText(value: unknown): string {
  return DOMPurify.sanitize(typeof value === "string" ? value : "", {
    ALLOWED_TAGS: PUBLIC_RICH_TEXT_TAGS,
    ALLOWED_ATTR: ["href"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "svg", "math"],
    FORBID_ATTR: [
      "style", "target", "rel", "onerror", "onload", "onclick", "onmouseover", "onfocus",
    ],
  });
}

/**
 * Safe HTML section contract for CMS-authored layout fragments. It permits
 * semantic layout, images, tables and reusable presentation classes, while
 * deliberately excluding executable code, inline CSS, embeds and forms.
 */
export function sanitizePublicHtmlContent(value: unknown): string {
  return DOMPurify.sanitize(typeof value === "string" ? value.slice(0, 200_000) : "", {
    ALLOWED_TAGS: PUBLIC_HTML_CONTENT_TAGS,
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "class", "id", "width", "height", "loading",
      "colspan", "rowspan", "scope", "open", "aria-label", "aria-labelledby",
      "aria-describedby",
    ],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "option", "svg", "math"],
    FORBID_ATTR: [
      "style", "target", "rel", "srcdoc", "onerror", "onload", "onclick", "onmouseover",
      "onfocus", "onmouseenter", "onmouseleave", "oninput", "onsubmit",
    ],
  });
}
