// markdown.js
// ------------------------------------------------------------------
// Safe markdown rendering for journal entries, with syntax highlighting
// for fenced code blocks.
//
// Pipeline:
//   raw markdown  ->  marked (with marked-highlight)  ->  highlighted HTML
//                 ->  DOMPurify (sanitize)             ->  safe HTML
//
// Syntax highlighting uses highlight.js, which is loaded as a global
// (`window.hljs`) by the script tag in index.html. If hljs is not yet
// available (e.g. script still loading on a slow connection), the
// code falls back to rendering fenced code blocks as plain text.
// ------------------------------------------------------------------

import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import { markedHighlight } from "https://cdn.jsdelivr.net/npm/marked-highlight@2/+esm";

let _marked = null;
let _purify = null;

function getHljs() {
  // hljs is provided by a <script> tag in index.html, which loads
  // synchronously (defer) before the ES modules. If for any reason
  // it isn't there yet, we degrade gracefully to no highlighting.
  if (typeof window === "undefined") return null;
  return window.hljs || null;
}

async function loadLibs() {
  if (_marked && _purify) return { marked: _marked, DOMPurify: _purify };
  const purifyMod = await import("https://cdn.jsdelivr.net/npm/dompurify@3/+esm");
  _purify = purifyMod.default;

  // Build a single Marked instance configured for:
  //   - GFM (tables, strikethrough, autolinks)
  //   - line breaks on single newlines (matches DayOne-like behavior)
  //   - no header-id mangling (cleaner output, smaller DOM)
  //   - syntax highlighting via hljs, with graceful fallback
  const hljs = getHljs();
  const highlightPlugin = markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      if (!hljs) return code; // graceful: no hljs yet
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      } catch (_) {
        return code;
      }
    },
  });
  _marked = new Marked(highlightPlugin);
  _marked.setOptions({
    gfm: true,
    breaks: true,
    mangle: false,
    headerIds: false,
  });
  return { marked: _marked, DOMPurify: _purify };
}

/**
 * Convert a markdown string to an HTML string, sanitized.
 * Returns "" on error or empty input.
 */
export async function renderMarkdownToHtml(md) {
  if (!md || !md.trim()) return "";
  try {
    const { marked, DOMPurify } = await loadLibs();
    const rawHtml = marked.parse(md);
    // DOMPurify with strict defaults: strip <script>, on* attrs, javascript: URLs.
    // We allow images because the journal uses them.
    const clean = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        "p", "br", "hr",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "strong", "em", "del", "code", "pre", "blockquote",
        "ul", "ol", "li",
        "a", "img",
        "table", "thead", "tbody", "tr", "th", "td",
        "span", // hljs injects <span class="hljs-..."> inside <code>
      ],
      ALLOWED_ATTR: [
        "href", "title", "alt", "src", "rel", "target",
        "class", // hljs uses class names like "hljs-keyword"
      ],
    });
    return clean;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("renderMarkdownToHtml failed:", e);
    // Fall back to escaped plaintext so we never inject raw user content.
    return `<p>${escapeHtml(md)}</p>`;
  }
}

/**
 * Convert markdown to an HTMLElement (DOM node), sanitized.
 * Always returns a single element. Empty input returns an empty <p></p>.
 */
export async function renderMarkdownNode(md) {
  const html = await renderMarkdownToHtml(md);
  const tpl = document.createElement("template");
  tpl.innerHTML = html || "<p></p>";
  return tpl.content.firstElementChild || document.createElement("p");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
