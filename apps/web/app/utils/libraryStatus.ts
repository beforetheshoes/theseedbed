const KNOWN_STATUS_LABELS: Record<string, string> = {
  to_read: 'To read',
  reading: 'Reading',
  completed: 'Completed',
  abandoned: 'Abandoned',
};

const titleCaseFromSnake = (value: string): string =>
  value
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');

export const libraryStatusLabel = (status: string): string => {
  if (!status) return '';
  return KNOWN_STATUS_LABELS[status] ?? titleCaseFromSnake(status);
};
