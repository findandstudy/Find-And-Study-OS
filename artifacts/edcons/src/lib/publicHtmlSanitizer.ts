import DOMPurify from "isomorphic-dompurify";

const PUBLIC_RICH_TEXT_TAGS = [
  "p", "br", "strong", "em", "b", "i", "u", "a", "ul", "ol", "li",
  "h2", "h3", "h4", "blockquote", "code", "pre", "span", "hr",
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
