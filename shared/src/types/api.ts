/**
 * Consistent API envelope used by every /api/* route (see section 73 of the build spec:
 * "Use consistent authentication, authorization, validation, response structure, error
 * structure, pagination, filtering").
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: {
    /** Stable machine-readable code, e.g. "VALIDATION_ERROR", "UNAUTHORIZED". */
    code: string;
    /** Safe, user-facing message. Never include stack traces or DB details here. */
    message: string;
    /** Correlates to the server-side log entry containing full technical detail. */
    errorId: string;
    fieldErrors?: Record<string, string[]>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
