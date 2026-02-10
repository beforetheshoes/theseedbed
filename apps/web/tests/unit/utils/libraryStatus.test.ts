import { describe, expect, it } from 'vitest';

import { libraryStatusLabel } from '../../../app/utils/libraryStatus';

describe('libraryStatusLabel', () => {
  it('formats known statuses', () => {
    expect(libraryStatusLabel('to_read')).toBe('To read');
    expect(libraryStatusLabel('reading')).toBe('Reading');
    expect(libraryStatusLabel('completed')).toBe('Completed');
    expect(libraryStatusLabel('abandoned')).toBe('Abandoned');
  });

  it('falls back to a reasonable title case for unknown snake_case', () => {
    expect(libraryStatusLabel('in_progress')).toBe('In Progress');
    expect(libraryStatusLabel('two__words')).toBe('Two Words');
  });

  it('returns empty string for empty input', () => {
    expect(libraryStatusLabel('')).toBe('');
  });
});
