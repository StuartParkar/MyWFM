/**
 * Base class for every error the app throws intentionally (as opposed to an
 * unexpected exception). `message` is always safe to show to the end user;
 * anything sensitive belongs in `logContext`, which only ever reaches the
 * server-side log (see middleware/errorHandler.ts), never the HTTP response.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly logContext: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public readonly fieldErrors?: Record<string, string[]>) {
    super("VALIDATION_ERROR", message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required.") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, logContext?: Record<string, unknown>) {
    super("CONFLICT", message, 409, logContext);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "A required upstream service is unavailable.", logContext?: Record<string, unknown>) {
    super("SERVICE_UNAVAILABLE", message, 503, logContext);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests. Please try again later.") {
    super("TOO_MANY_REQUESTS", message, 429);
  }
}
