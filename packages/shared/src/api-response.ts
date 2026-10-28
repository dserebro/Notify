import { z } from "zod";
import { type FailureType, FailureTypeSchema } from "./failures.js";

/**
 * Error object carried by a failed `ApiResponse`. Matches the shape
 * produced by the legacy backend (`failure(...)` in
 * `types/apiresponse.ts`): a typed `type` discriminator and a
 * human-readable `message`.
 */
export const ApiErrorSchema = z.object({
    type: FailureTypeSchema,
    message: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Successful envelope: `{ successful: true, data }`. `data` is
 * modelled as `unknown` on the schema; call sites use the generic
 * helpers below for type-safe construction/parsing.
 */
export const SuccessResponseSchema = z.object({
    successful: z.literal(true),
    data: z.unknown(),
});

export type SuccessResponse<T = unknown> = {
    successful: true;
    data: T;
};

/**
 * Error envelope: `{ successful: false, error: ApiError }`.
 */
export const ErrorResponseSchema = z.object({
    successful: z.literal(false),
    error: ApiErrorSchema,
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * The full API envelope used by every `/api/*` response.
 */
export const ApiResponseSchema = z.discriminatedUnion("successful", [
    SuccessResponseSchema,
    ErrorResponseSchema,
]);

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

/**
 * Build a success envelope. Returns the JSON-serializable object only;
 * the server wraps it with `c.json(...)` and sets headers at the Hono
 * layer, and tests can assert on the plain object directly.
 */
export function success<T>(data: T): SuccessResponse<T> {
    return { successful: true, data };
}

/**
 * Build a failure envelope. Returns the JSON-serializable object only
 * (not a `Response`); the Hono layer handles status codes and headers.
 */
export function failure(type: FailureType, message: string): ErrorResponse {
    return { successful: false, error: { type, message } };
}

/**
 * Narrowing predicate: `response.successful === true`.
 */
export function isSuccess<T>(
    response: ApiResponse<T>,
): response is SuccessResponse<T> {
    return response.successful;
}
