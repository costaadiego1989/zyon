/**
 * SUPP-H5: Strip HTML tags from AI-generated replies.
 * Defense-in-depth against XSS — even if the widget also escapes on render.
 */
const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi;
const SCRIPT_RE = /<script[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style[^>]*>[\s\S]*?<\/style>/gi;

export function stripHtmlFromReply(text: string): string {
  return text
    .replace(SCRIPT_RE, "")
    .replace(STYLE_RE, "")
    .replace(HTML_TAG_RE, "")
    .trim();
}
