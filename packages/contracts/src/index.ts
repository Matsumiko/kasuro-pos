export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
};

export type ApiResponse<T> = { data: T; meta?: Record<string, unknown> };
export * from './auth';
