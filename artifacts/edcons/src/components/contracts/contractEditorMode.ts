/** Rich-text commands cannot round-trip a designed HTML document faithfully. */
export function requiresContractHtmlEditing(value: string): boolean {
  return /<(?:!doctype|html|head|body|style|link|table|thead|tbody|tfoot|tr|td|th|div|section|article|header|footer|main|aside|nav|img)\b/i.test(value)
    || /\s(?:class|style)\s*=/i.test(value);
}
