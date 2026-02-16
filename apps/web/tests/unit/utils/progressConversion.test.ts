import { describe, expect, it } from 'vitest';
import {
  canConvert,
  fromCanonicalPercent,
  toCanonicalPercent,
} from '../../../app/utils/progressConversion';

describe('progressConversion', () => {
  it('converts pages and minutes through canonical percent', () => {
    const totals = { total_pages: 300, total_audio_minutes: 600 };
    const canonical = toCanonicalPercent('pages_read', 75, totals);
    expect(canonical).toBe(25);
    expect(fromCanonicalPercent('minutes_listened', canonical ?? 0, totals)).toBe(150);
  });

  it('rounds converted values to whole numbers', () => {
    const totals = { total_pages: 333, total_audio_minutes: 1000 };
    expect(fromCanonicalPercent('pages_read', 12.6, totals)).toBe(42);
    expect(fromCanonicalPercent('minutes_listened', 12.6, totals)).toBe(126);
  });

  it('clamps percent and enforces totals requirements', () => {
    expect(
      toCanonicalPercent('percent_complete', 120, { total_pages: null, total_audio_minutes: null }),
    ).toBe(100);
    expect(
      toCanonicalPercent('pages_read', 10, { total_pages: null, total_audio_minutes: null }),
    ).toBeNull();
    expect(
      canConvert('pages_read', 'minutes_listened', {
        total_pages: null,
        total_audio_minutes: null,
      }),
    ).toEqual({
      canConvert: false,
      missing: ['total_pages', 'total_audio_minutes'],
    });
  });

  it('handles invalid numeric inputs and same-unit conversion checks', () => {
    const totals = { total_pages: 100, total_audio_minutes: 80 };
    expect(toCanonicalPercent('minutes_listened', Number.NaN, totals)).toBeNull();
    expect(fromCanonicalPercent('percent_complete', Number.NaN, totals)).toBeNull();
    expect(canConvert('pages_read', 'pages_read', totals)).toEqual({
      canConvert: true,
      missing: [],
    });
  });

  it('covers minutes and pages specific missing-total paths', () => {
    const missingMinutes = { total_pages: 100, total_audio_minutes: null };
    expect(toCanonicalPercent('minutes_listened', 10, missingMinutes)).toBeNull();
    expect(fromCanonicalPercent('minutes_listened', 30, missingMinutes)).toBeNull();
    expect(canConvert('percent_complete', 'minutes_listened', missingMinutes)).toEqual({
      canConvert: false,
      missing: ['total_audio_minutes'],
    });

    const missingPages = { total_pages: null, total_audio_minutes: 120 };
    expect(fromCanonicalPercent('pages_read', 30, missingPages)).toBeNull();
    expect(canConvert('percent_complete', 'pages_read', missingPages)).toEqual({
      canConvert: false,
      missing: ['total_pages'],
    });
  });

  it('converts minutes to canonical percent when totals exist', () => {
    const totals = { total_pages: 300, total_audio_minutes: 240 };
    expect(toCanonicalPercent('minutes_listened', 60, totals)).toBe(25);
    expect(canConvert('minutes_listened', 'percent_complete', totals)).toEqual({
      canConvert: true,
      missing: [],
    });
  });
});
