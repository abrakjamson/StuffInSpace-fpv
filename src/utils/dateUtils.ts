import { DateTime } from 'luxon';

function ensureJsDate (date: unknown): Date | undefined {
  if (typeof date === 'string') {
    return DateTime.fromISO(date).toJSDate();
  } else if (date instanceof Date) {
    return date;
  }

  return undefined;
}

export { ensureJsDate };