import type {
    ApiResponse,
    ErrorResponse,
    SuccessResponse,
} from "@notify/shared";
import { isSuccess } from "@notify/shared";

// Keep the historical name used throughout the PWA.
export type IApiResponse<T = never> = ApiResponse<T>;
export type { ErrorResponse, SuccessResponse };
export { isSuccess };

export function parseResponse<T = never>(response: ApiResponse<T>): T {
    if (isSuccess(response)) {
        return response.data as T;
    }
    throw new Error(response.error.message);
}
