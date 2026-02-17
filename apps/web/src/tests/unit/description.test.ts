import { describe, expect, it } from "vitest";
import { renderDescriptionHtml } from "@/lib/description";

describe("renderDescriptionHtml", () => {
  // ── Null / empty / whitespace ──────────────────────────────────────
  it("returns empty string for null", () => {
    expect(renderDescriptionHtml(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(renderDescriptionHtml(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(renderDescriptionHtml("")).toBe("");
  });

  it("returns empty string for whitespace-only string", () => {
    expect(renderDescriptionHtml("   \n  ")).toBe("");
  });

  // ── Plain markdown (no HTML tags) ─────────────────────────────────
  it("renders plain text as markdown block by default", () => {
    const result = renderDescriptionHtml("Hello world");
    expect(result).toContain("<p>Hello world</p>");
  });

  it("renders inline markdown when inline option is set", () => {
    const result = renderDescriptionHtml("Hello **world**", { inline: true });
    expect(result).toContain("<strong>world</strong>");
    // Inline should not wrap in <p>
    expect(result).not.toContain("<p>");
  });

  it("renders markdown bold/italic in block mode", () => {
    const result = renderDescriptionHtml("This is **bold** and *italic*.");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("renders markdown links", () => {
    const result = renderDescriptionHtml("[link](https://example.com)");
    expect(result).toContain('href="https://example.com"');
  });

  // ── Google Markdown artifact cleanup ──────────────────────────────
  it("cleans Google Markdown artifacts (leading asterisks with smart quotes)", () => {
    // Pattern: line starting with * followed by smart quote
    const input = "*\u201CHello world\u201D*";
    const result = renderDescriptionHtml(input);
    // Should strip the asterisks and render as plain text with breaks
    expect(result).toContain("\u201CHello world\u201D");
    expect(result).not.toContain("*");
  });

  it("cleans Google Markdown artifacts (trailing asterisks with smart quotes)", () => {
    const input = "\u201CHello\u201D*\n";
    const result = renderDescriptionHtml(input);
    expect(result).toContain("\u201CHello\u201D");
  });

  it("cleans Google Markdown artifacts (lines with only asterisks)", () => {
    const input = "Hello\n***\nWorld";
    const result = renderDescriptionHtml(input);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("returns empty string when Google artifact cleanup yields empty text", () => {
    // Input that is entirely asterisks on each line
    const input = "***\n**\n*";
    const result = renderDescriptionHtml(input);
    expect(result).toBe("");
  });

  // ── HTML sanitization ─────────────────────────────────────────────
  it("sanitizes HTML and keeps allowed tags", () => {
    const result = renderDescriptionHtml("<p>Hello <strong>world</strong></p>");
    expect(result).toContain("<p>");
    expect(result).toContain("<strong>world</strong>");
  });

  it("strips disallowed tags but keeps their text content", () => {
    const result = renderDescriptionHtml("<div><span>Hello</span></div>");
    expect(result).toContain("Hello");
    expect(result).not.toContain("<div>");
    expect(result).not.toContain("<span>");
  });

  it("sanitizes anchor tags: allows safe href, adds rel and target", () => {
    const result = renderDescriptionHtml(
      '<a href="https://example.com">Link</a>',
    );
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer nofollow"');
    expect(result).toContain('target="_blank"');
  });

  it("allows relative href values", () => {
    const result = renderDescriptionHtml('<a href="/page">Link</a>');
    expect(result).toContain('href="/page"');
  });

  it("allows hash href values", () => {
    const result = renderDescriptionHtml('<a href="#section">Link</a>');
    expect(result).toContain('href="#section"');
  });

  it("allows query href values", () => {
    const result = renderDescriptionHtml('<a href="?q=test">Link</a>');
    expect(result).toContain('href="?q=test"');
  });

  it("allows mailto href values", () => {
    const result = renderDescriptionHtml(
      '<a href="mailto:test@example.com">Email</a>',
    );
    expect(result).toContain('href="mailto:test@example.com"');
  });

  it("strips unsafe href (javascript:) from anchors", () => {
    const result = renderDescriptionHtml(
      '<a href="javascript:alert(1)">Click</a>',
    );
    expect(result).not.toContain("javascript:");
  });

  it("strips empty href from anchors", () => {
    const result = renderDescriptionHtml('<a href="">Click</a>');
    expect(result).not.toContain('href=""');
  });

  it("strips href with unsupported scheme (ftp:)", () => {
    const result = renderDescriptionHtml('<a href="ftp://example.com">FTP</a>');
    expect(result).not.toContain("ftp:");
  });

  it("renders allowed list tags", () => {
    const result = renderDescriptionHtml(
      "<ul><li>Item 1</li><li>Item 2</li></ul>",
    );
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>");
  });

  it("renders ordered list tags", () => {
    const result = renderDescriptionHtml(
      "<ol><li>First</li><li>Second</li></ol>",
    );
    expect(result).toContain("<ol>");
    expect(result).toContain("<li>");
  });

  it("renders blockquote tags", () => {
    const result = renderDescriptionHtml("<blockquote>A quote</blockquote>");
    expect(result).toContain("<blockquote>");
  });

  it("renders code tags", () => {
    const result = renderDescriptionHtml("<code>let x = 1;</code>");
    expect(result).toContain("<code>");
  });

  it("renders br tags", () => {
    const result = renderDescriptionHtml("Line 1<br>Line 2");
    expect(result).toContain("<br>");
  });

  it("renders em and i tags", () => {
    const result = renderDescriptionHtml("<em>emphasis</em> <i>italic</i>");
    expect(result).toContain("<em>");
    expect(result).toContain("<i>");
  });

  it("renders b tags", () => {
    const result = renderDescriptionHtml("<b>bold</b>");
    expect(result).toContain("<b>");
  });

  it("strips script tags completely", () => {
    const result = renderDescriptionHtml(
      '<p>Hello</p><script>alert("xss")</script>',
    );
    expect(result).not.toContain("<script>");
    expect(result).toContain("Hello");
  });

  it("returns empty string when sanitized HTML is empty", () => {
    // A tag that is stripped entirely with no text content
    const result = renderDescriptionHtml("<img />");
    expect(result).toBe("");
  });

  it("falls back to markdown rendering when HTML tags are fully stripped", () => {
    // <span> is not allowed, so it gets stripped; the remaining text should be rendered as markdown
    const result = renderDescriptionHtml("<span>**bold text**</span>");
    expect(result).toContain("<strong>bold text</strong>");
  });

  // ── HTML escaping for plain text with breaks ──────────────────────
  it("escapes special HTML characters in Google artifact cleanup path", () => {
    // Trigger the Google artifacts path: no HTML tags, but has Google artifact
    // patterns. The line "***" alone triggers hasLikelyGoogleMarkdownArtifacts.
    // After cleanup, renderPlainTextWithBreaks escapes HTML entities.
    // Use & and ' (non-HTML-tag chars) with a *** separator line.
    const input = "Hello & 'world'\n***\nLine 2";
    const result = renderDescriptionHtml(input);
    expect(result).toContain("&amp;");
    expect(result).toContain("&#39;");
    expect(result).toContain("<br>");
  });

  it("handles anchor with invalid URL that is not a relative path", () => {
    // An href like "::invalid" is not relative (no /, #, ?) and not a valid URL,
    // so isSafeHref should catch the URL parse error and return false.
    const result = renderDescriptionHtml('<a href="::invalid">Link</a>');
    // The anchor should still be rendered but without href
    expect(result).toContain("Link");
    expect(result).not.toContain('href="::invalid"');
  });

  it("falls back to plain text with breaks when DOMParser is unavailable", () => {
    const origDOMParser = globalThis.DOMParser;
    try {
      // @ts-expect-error -- intentionally removing DOMParser for test
      delete globalThis.DOMParser;
      const result = renderDescriptionHtml("<p>Hello</p>");
      // Without DOMParser, it should fall back to escaping the HTML
      expect(result).toContain("&lt;p&gt;");
      expect(result).toContain("Hello");
    } finally {
      globalThis.DOMParser = origDOMParser;
    }
  });

  // ── Text node handling ────────────────────────────────────────────
  it("preserves text nodes during sanitization", () => {
    const result = renderDescriptionHtml("<p>Just text</p>");
    expect(result).toContain("Just text");
  });

  it("handles anchor without href attribute", () => {
    // An anchor element with no href attribute at all.
    // getAttribute("href") returns null, triggering the ?? "" fallback.
    const result = renderDescriptionHtml("<a>No href</a>");
    expect(result).toContain("No href");
    expect(result).not.toContain("href=");
  });

  it("ignores HTML comment nodes", () => {
    // Comment nodes have nodeType === Node.COMMENT_NODE (8), which is
    // neither TEXT_NODE nor ELEMENT_NODE, triggering the early return.
    const result = renderDescriptionHtml(
      "<p>Hello</p><!-- comment --><p>World</p>",
    );
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("comment");
  });

  it("handles empty text nodes in sanitized HTML", () => {
    // Whitespace-only or empty text nodes between elements.
    const result = renderDescriptionHtml("<p></p><p>Content</p>");
    expect(result).toContain("Content");
  });

  // ── Mixed content ─────────────────────────────────────────────────
  it("handles mixed HTML and text", () => {
    const result = renderDescriptionHtml(
      "<p>Hello <strong>world</strong> and <em>goodbye</em></p>",
    );
    expect(result).toContain("Hello");
    expect(result).toContain("<strong>world</strong>");
    expect(result).toContain("<em>goodbye</em>");
  });
});
