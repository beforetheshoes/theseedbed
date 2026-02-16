export type ProgressUnit = 'pages_read' | 'percent_complete' | 'minutes_listened';

export type ProgressTotals = {
  total_pages: number | null;
  total_audio_minutes: number | null;
};

export type ConversionCapability = {
  canConvert: boolean;
  missing: Array<'total_pages' | 'total_audio_minutes'>;
};

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const roundWhole = (value: number): number => Math.round(value);

export const toCanonicalPercent = (
  unit: ProgressUnit,
  value: number,
  totals: ProgressTotals,
): number | null => {
  if (Number.isNaN(value) || value < 0) return null;

  if (unit === 'percent_complete') return clampPercent(value);
  if (unit === 'pages_read') {
    if (!totals.total_pages || totals.total_pages < 1) return null;
    return clampPercent((value / totals.total_pages) * 100);
  }
  if (!totals.total_audio_minutes || totals.total_audio_minutes < 1) return null;
  return clampPercent((value / totals.total_audio_minutes) * 100);
};

export const fromCanonicalPercent = (
  unit: ProgressUnit,
  canonicalPercent: number,
  totals: ProgressTotals,
): number | null => {
  if (Number.isNaN(canonicalPercent)) return null;
  const percent = clampPercent(canonicalPercent);

  if (unit === 'percent_complete') return roundWhole(percent);
  if (unit === 'pages_read') {
    if (!totals.total_pages || totals.total_pages < 1) return null;
    return roundWhole((percent / 100) * totals.total_pages);
  }
  if (!totals.total_audio_minutes || totals.total_audio_minutes < 1) return null;
  return roundWhole((percent / 100) * totals.total_audio_minutes);
};

export const canConvert = (
  from: ProgressUnit,
  to: ProgressUnit,
  totals: ProgressTotals,
): ConversionCapability => {
  if (from === to) return { canConvert: true, missing: [] };

  const missing = new Set<'total_pages' | 'total_audio_minutes'>();
  const needsPages =
    (from === 'pages_read' && to !== 'pages_read') ||
    (to === 'pages_read' && from !== 'pages_read');
  const needsMinutes =
    (from === 'minutes_listened' && to !== 'minutes_listened') ||
    (to === 'minutes_listened' && from !== 'minutes_listened');

  if (needsPages && (!totals.total_pages || totals.total_pages < 1)) {
    missing.add('total_pages');
  }
  if (needsMinutes && (!totals.total_audio_minutes || totals.total_audio_minutes < 1)) {
    missing.add('total_audio_minutes');
  }

  const missingList = [...missing];
  return {
    canConvert: missingList.length === 0,
    missing: missingList,
  };
};
