import { createError, defineEventHandler, getRequestHeader } from 'h3';

const wantsActivityPub = (acceptHeader: string) => {
  const accept = acceptHeader.toLowerCase();
  return accept.includes('application/activity+json');
};

export default defineEventHandler((event) => {
  // Reserve ActivityPub variants of user profile URLs without implementing federation yet.
  if (!event.path.startsWith('/u/')) {
    return;
  }

  const accept = getRequestHeader(event, 'accept') ?? '';
  if (!accept || !wantsActivityPub(accept)) {
    return;
  }

  throw createError({
    statusCode: 406,
    statusMessage: 'Not Acceptable',
    message: 'ActivityPub is not implemented yet.',
  });
});
