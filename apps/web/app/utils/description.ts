import MarkdownIt from 'markdown-it';

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

const allowedDescriptionTags = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'em',
  'i',
  'li',
  'ol',
  'p',
  'strong',
  'ul',
] as const;

const allowedDescriptionTagSet = new Set<string>(allowedDescriptionTags);
const allowedDescriptionSchemes = new Set(['http:', 'https:', 'mailto:']);

const isSafeHref = (href: string): boolean => {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) return true;
  try {
    const parsed = new URL(trimmed);
    return allowedDescriptionSchemes.has(parsed.protocol);
  } catch {
    return false;
  }
};

const sanitizeDescriptionHtmlInBrowser = (value: string): string => {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return renderPlainTextWithBreaks(value);
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(value, 'text/html');
  const output = document.createElement('div');

  const appendSanitized = (node: ChildNode, parent: HTMLElement) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) parent.append(text);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (!allowedDescriptionTagSet.has(tag)) {
      for (const child of Array.from(element.childNodes)) appendSanitized(child, parent);
      return;
    }

    const sanitized = document.createElement(tag);
    if (tag === 'a') {
      const href = element.getAttribute('href') ?? '';
      if (isSafeHref(href)) sanitized.setAttribute('href', href);
      sanitized.setAttribute('rel', 'noopener noreferrer nofollow');
      sanitized.setAttribute('target', '_blank');
    }

    for (const child of Array.from(element.childNodes)) appendSanitized(child, sanitized);
    parent.append(sanitized);
  };

  for (const child of Array.from(parsed.body.childNodes)) appendSanitized(child, output);
  return output.innerHTML.trim();
};

const sanitizeDescriptionHtml = (value: string): string => {
  return sanitizeDescriptionHtmlInBrowser(value);
};

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
