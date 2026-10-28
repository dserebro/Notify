/**
 * JWK shape used for VAPID application-server keys. Mirrors the legacy
 * `app/backend/webpush/jwk.ts` interface so the base64(JWK) private key
 * format stored by existing deployments keeps importing unchanged.
 */
export interface JWK {
    crv: string;
    kty: string;
    key_ops: string[];
    ext: boolean;
    d: string;
    x: string;
    y: string;
}
