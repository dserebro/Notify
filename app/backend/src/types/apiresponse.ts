import { ApiError } from "./failures";

const DEFAULT_API_HEADERS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
};

export function success<T>(data: T, additions?: unknown): Response {
    const responseMetaData = Object.assign({
        status: 200,
        headers: DEFAULT_API_HEADERS,
    }, additions);
    return new Response(JSON.stringify({ successful: true, data }), responseMetaData);
}

export function failure(error: ApiError, additions?: unknown): Response {
    const responseMetaData = Object.assign({
        status: 500,
        headers: DEFAULT_API_HEADERS,
    }, additions);
    return new Response(JSON.stringify({ successful: false, error }), responseMetaData);
}