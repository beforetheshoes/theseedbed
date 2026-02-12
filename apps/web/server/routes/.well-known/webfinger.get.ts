import { defineEventHandler, setHeader, setResponseStatus } from 'h3';

export default defineEventHandler((event) => {
  setResponseStatus(event, 501, 'Not Implemented');
  setHeader(event, 'content-type', 'application/json; charset=utf-8');

  return {
    error: 'not_implemented',
    message: 'WebFinger is reserved for future federation support.',
  };
});
