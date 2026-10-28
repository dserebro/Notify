import { z } from "zod";

/**
 * String enum of failure types produced by the Notify API's error envelope.
 *
 * Ported verbatim from the legacy backend's `types/failures.ts` so the
 * public contract (and the error strings surfaced to webhooks/clients)
 * does not drift. The server emits one of these values in
 * `ApiError.type`; clients can match on it.
 */
export const FailureTypeSchema = z.enum([
    "auth_required",
    "missing_data",
    "invalid_data",
    "not_found",
    "internal_error",
]);

export type FailureType = z.infer<typeof FailureTypeSchema>;
