// Express 4 doesn't catch rejected promises; this forwards them to the error handler.
export function route(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
