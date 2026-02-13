import { describe, expect, it } from 'vitest';

import { renderDescriptionHtml } from '../../../app/utils/description';

describe('description utils', () => {
  it('returns empty for nullish/blank inputs', () => {
    expect(renderDescriptionHtml()).toBe('');
    expect(renderDescriptionHtml('   ')).toBe('');
  });

  it('renders markdown when no html tags are present', () => {
    const block = renderDescriptionHtml('This is **bold** text.');
    expect(block).toContain('<strong>bold</strong>');
    const inline = renderDescriptionHtml('This is **bold** text.', { inline: true });
    expect(inline).toContain('<strong>bold</strong>');
    expect(inline).not.toContain('<p>');
  });

  it('sanitizes and preserves supported html tags', () => {
    const input = '<b>Bold</b> and <i>italics</i><br>line 2';
    const rendered = renderDescriptionHtml(input);
    expect(rendered).toContain('<b>Bold</b>');
    expect(rendered).toContain('<i>italics</i>');
    expect(rendered).toContain('<br');
  });

  it('strips unsafe tags and still supports markdown in mixed content', () => {
    const input = '<script>alert(1)</script> **bold**';
    const rendered = renderDescriptionHtml(input, { inline: true });
    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('alert(1)');
    expect(rendered).toContain('<strong>bold</strong>');
  });

  it('drops disallowed/unsafe links and normalizes safe links', () => {
    const unsafeLink = renderDescriptionHtml('<a href="javascript:alert(1)">bad</a>');
    expect(unsafeLink).toContain('target="_blank"');
    expect(unsafeLink).toContain('rel="noopener noreferrer nofollow"');
    expect(unsafeLink).not.toContain('javascript:');

    const safeLink = renderDescriptionHtml('<a href="https://example.com">ok</a>');
    expect(safeLink).toContain('href="https://example.com"');

    const missingHref = renderDescriptionHtml('<a>no href</a>');
    expect(missingHref).not.toContain('href=');
    expect(missingHref).toContain('target="_blank"');
  });

  it('returns empty when html input is fully stripped', () => {
    const rendered = renderDescriptionHtml('<script>alert(1)</script>');
    expect(rendered).toBe('');
  });

  it('cleans malformed star artifacts and renders plain text breaks', () => {
    const input = `*“Nolan is a skillful satirist.”—“Review”*
“A self-assured debut.”—“Kirkus”
**
“A stunner.”—“Julia Phillips”**`;
    const rendered = renderDescriptionHtml(input);
    expect(rendered).toContain('“Nolan is a skillful satirist.”—“Review”');
    expect(rendered).not.toContain('<ul>');
    expect(rendered).not.toContain('**');
    expect(rendered).not.toMatch(/(^|>)\*($|<)/);
  });
});
