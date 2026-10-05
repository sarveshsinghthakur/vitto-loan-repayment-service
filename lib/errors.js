export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function jsonError(status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return Response.json({ error }, { status });
}

export function errorResponse(error) {
  if (error instanceof AppError) {
    return jsonError(error.status, error.code, error.message, error.details);
  }
  console.error('Unhandled error:', error);
  return jsonError(500, 'internal_error', 'An unexpected error occurred');
}
