import { beforeEach, describe, expect, it, vi } from 'vitest';

const updatePrimaryPaletteMock = vi.hoisted(() => vi.fn());
const updatePresetMock = vi.hoisted(() => vi.fn());

vi.mock('@primeuix/themes', () => ({
  updatePrimaryPalette: updatePrimaryPaletteMock,
  updatePreset: updatePresetMock,
}));

import {
  applyUserTheme,
  getThemeWarnings,
  normalizeHexColor,
} from '../../../app/composables/useUserTheme';

describe('useUserTheme', () => {
  beforeEach(() => {
    updatePrimaryPaletteMock.mockReset();
    updatePresetMock.mockReset();
    document.documentElement.style.cssText = '';
  });

  it('normalizes valid hex colors and rejects invalid values', () => {
    expect(normalizeHexColor(null)).toBeNull();
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor('#abc123')).toBe('#ABC123');
    expect(normalizeHexColor(' #0011ff ')).toBe('#0011FF');
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('blue')).toBeNull();
  });

  it('applies css variables and primevue runtime palette updates', () => {
    const result = applyUserTheme({
      theme_primary_color: '#112233',
      theme_accent_color: '#445566',
      theme_font_family: 'fraunces',
    });

    expect(result?.primary).toBe('#112233'.toUpperCase());
    expect(document.documentElement.style.getPropertyValue('--app-theme-primary')).toBe(
      '#112233'.toUpperCase(),
    );
    expect(document.documentElement.style.getPropertyValue('--app-theme-accent')).toBe(
      '#445566'.toUpperCase(),
    );
    expect(document.documentElement.style.getPropertyValue('--app-font-family')).toContain(
      'Fraunces',
    );
    expect(updatePrimaryPaletteMock).toHaveBeenCalledTimes(1);
    expect(updatePresetMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to defaults when persisted values are malformed', () => {
    const result = applyUserTheme({
      theme_primary_color: 'bad',
      theme_accent_color: '#12345',
      theme_font_family: null,
    });

    expect(result?.primary).toBe('#6366F1');
    expect(result?.accent).toBe('#14B8A6');
    expect(result?.fontFamily).toBe('ibm_plex_sans');
  });

  it('returns warning entries for low-contrast colors', () => {
    const warnings = getThemeWarnings({
      theme_primary_color: '#FFFFFF',
      theme_accent_color: '#000000',
    });

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((item) => item.message.includes('light mode'))).toBe(true);
    expect(warnings.some((item) => item.message.includes('dark mode'))).toBe(true);
  });

  it('returns no warnings for colors with sufficient contrast', () => {
    const warnings = getThemeWarnings({
      theme_primary_color: '#2563EB',
      theme_accent_color: '#2563EB',
    });
    expect(warnings).toEqual([]);
  });

  it('does nothing when document is unavailable', () => {
    const previous = globalThis.document;
    // @ts-expect-error test-only
    globalThis.document = undefined;
    expect(applyUserTheme({ theme_primary_color: '#123456' })).toBeUndefined();
    // @ts-expect-error test-only
    globalThis.document = previous;
  });

  it('swallows runtime palette update errors', () => {
    updatePrimaryPaletteMock.mockImplementationOnce(() => {
      throw new Error('theme failure');
    });
    expect(() =>
      applyUserTheme({
        theme_primary_color: '#123456',
        theme_accent_color: '#654321',
        theme_font_family: 'atkinson',
      }),
    ).not.toThrow();
  });
});
