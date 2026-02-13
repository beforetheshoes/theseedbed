import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

const markdownInline = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

const markdownBlock = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

const containsHtmlTags = (value: string): boolean => /<\/?[a-z][\s\S]*>/i.test(value);
const hasLikelyGoogleMarkdownArtifacts = (value: string): boolean =>
  /(^|\n)\*["“]/m.test(value) ||
  /["”]\*(\n|$)/m.test(value) ||
  /(^|\n)\*{1,3}\s*(\n|$)/m.test(value);

const cleanupGoogleMarkdownArtifacts = (value: string): string =>
  value
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (/^\*{1,3}$/.test(trimmed)) return '';
      return line.replace(/^\*+(?=\S)/, '').replace(/(?<=\S)\*+$/, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderPlainTextWithBreaks = (value: string): string =>
  escapeHtml(value).replace(/\n/g, '<br>');

const sanitizeDescriptionHtml = (value: string): string =>
  sanitizeHtml(value, {
    allowedTags: ['a', 'b', 'blockquote', 'br', 'code', 'em', 'i', 'li', 'ol', 'p', 'strong', 'ul'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          href: attribs.href ?? '',
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
    },
  }).trim();

export const renderDescriptionHtml = (
  value?: string | null,
  options: { inline?: boolean } = {},
): string => {
  if (!value) return '';
  const normalized = value.trim();
  if (!normalized) return '';

  const renderMarkdown = options.inline
    ? markdownInline.renderInline.bind(markdownInline)
    : markdownBlock.render.bind(markdownBlock);

  if (!containsHtmlTags(normalized)) {
    if (hasLikelyGoogleMarkdownArtifacts(normalized)) {
      const cleaned = cleanupGoogleMarkdownArtifacts(normalized);
      return cleaned ? renderPlainTextWithBreaks(cleaned) : '';
    }
    return renderMarkdown(normalized);
  }

  const sanitized = sanitizeDescriptionHtml(normalized);
  if (!sanitized) return '';

  // For mixed strings where tags are stripped out completely, keep markdown formatting support.
  if (!containsHtmlTags(sanitized)) {
    return renderMarkdown(sanitized);
  }
  return sanitized;
};
