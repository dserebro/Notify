import type { webcrypto } from "node:crypto";
import type { WebPushData } from "@notify/shared";
import { hkdfGenerate } from "./hkdf.js";
import type { JWK } from "./jwk.js";
import {
    b64ToUrlEncoded,
    cryptoKeysToUint8Array,
    exportPublicKeyPair,
    joinUint8Arrays,
    stringToU8Array,
    u8ToString,
} from "./util.js";

/**
 * `aesgcm` payload encryption (draft-ietf-webpush-encryption-04).
 *
 * - a fresh server ECDH P-256 keypair is generated per message;
 * - the shared secret is derived from the subscriber's public key;
 * - HKDF with the "Content-Encoding: auth" / "aesgcm" / "nonce" labels
 *   produces the pseudo-random key, content-encryption key and nonce;
 * - the record is `[2-byte padding length = 0][payload]`, encrypted
 *   with AES-128-GCM (tagLength 128);
 * - the caller sends `Encryption: salt=<salt>` and
 *   `Crypto-Key: dh=<serverPublicKey>` next to the ciphertext.
 *
 * Algorithm names, HKDF labels, salt size (16) and auth secret length
 * are preserved byte-for-byte from `app/backend/webpush/message.ts` so
 * already-subscribed browsers can still decrypt the output.
 */

type mKeyPair = {
    publicKey: webcrypto.CryptoKey;
    privateKey: webcrypto.CryptoKey;
};

function generateSalt(length = 16): Promise<Uint8Array> {
    return Promise.resolve(crypto.getRandomValues(new Uint8Array(length)));
}

async function getSubKeyAsCryptoKey(
    subscription: WebPushData,
): Promise<webcrypto.CryptoKey> {
    const key = atob(subscription.key);
    const publicKey = await crypto.subtle.importKey(
        "jwk",
        {
            kty: "EC",
            crv: "P-256",
            x: b64ToUrlEncoded(btoa(key.slice(1, 33))),
            y: b64ToUrlEncoded(btoa(key.slice(33, 65))),
            ext: true,
        },
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        true,
        [],
    );
    return publicKey;
}

async function getSharedSecret(
    subscription: WebPushData,
    serverKeys: mKeyPair,
): Promise<ArrayBuffer> {
    const publicKey = await getSubKeyAsCryptoKey(subscription);
    const algorithm = {
        name: "ECDH",
        namedCurve: "P-256",
        public: publicKey,
    };
    return await crypto.subtle.deriveBits(
        algorithm,
        serverKeys.privateKey,
        256,
    );
}

export async function generateContext(
    subscription: WebPushData,
    serverKeys: mKeyPair,
): Promise<Uint8Array> {
    const subKey = await getSubKeyAsCryptoKey(subscription);

    const [clientPublicKey, serverPublicKey] = await Promise.all([
        cryptoKeysToUint8Array(subKey).then((key) => key.publicKey),
        cryptoKeysToUint8Array(serverKeys.publicKey).then(
            (key) => key.publicKey,
        ),
    ]);

    const labelUnit8Array = stringToU8Array("P-256\x00");

    const clientPublicKeyLengthUnit8Array = new Uint8Array(2);
    clientPublicKeyLengthUnit8Array[0] = 0x00;
    clientPublicKeyLengthUnit8Array[1] = clientPublicKey.byteLength;

    const serverPublicKeyLengthBuffer = new Uint8Array(2);
    serverPublicKeyLengthBuffer[0] = 0x00;
    serverPublicKeyLengthBuffer[1] = serverPublicKey.byteLength;

    return joinUint8Arrays([
        labelUnit8Array,
        clientPublicKeyLengthUnit8Array,
        clientPublicKey,
        serverPublicKeyLengthBuffer,
        serverPublicKey,
    ]);
}

async function generatePRK(
    subscription: WebPushData,
    serverKeys: mKeyPair,
): Promise<ArrayBuffer> {
    const sharedSecret = await getSharedSecret(subscription, serverKeys);
    const token = "Content-Encoding: auth\x00";
    const authInfoUint8Array = stringToU8Array(token);
    return await hkdfGenerate(
        sharedSecret,
        stringToU8Array(atob(subscription.auth)),
        authInfoUint8Array,
        32,
    );
}

async function generateCEKInfo(
    subscription: WebPushData,
    serverKeys: mKeyPair,
): Promise<Uint8Array> {
    const token = "Content-Encoding: aesgcm\x00";
    const contentEncoding8Array = stringToU8Array(token);
    const contextBuffer = await generateContext(subscription, serverKeys);
    return joinUint8Arrays([contentEncoding8Array, contextBuffer]);
}

async function generateNonceInfo(
    subscription: WebPushData,
    serverKeys: mKeyPair,
): Promise<Uint8Array> {
    const token = "Content-Encoding: nonce\x00";
    const contentEncoding8Array = stringToU8Array(token);
    const contextBuffer = await generateContext(subscription, serverKeys);
    return joinUint8Arrays([contentEncoding8Array, contextBuffer]);
}

export async function generateEncryptionKeys(
    subscription: WebPushData,
    salt: Uint8Array,
    serverKeys: mKeyPair,
): Promise<{ contentEncryptionKey: ArrayBuffer; nonce: ArrayBuffer }> {
    const [prk, cekInfo, nonceInfo] = await Promise.all([
        generatePRK(subscription, serverKeys),
        generateCEKInfo(subscription, serverKeys),
        generateNonceInfo(subscription, serverKeys),
    ]);
    const [contentEncryptionKey, nonce] = await Promise.all([
        hkdfGenerate(prk, salt, cekInfo, 16),
        hkdfGenerate(prk, salt, nonceInfo, 12),
    ]);
    return { contentEncryptionKey, nonce };
}

async function generateServerKey(): Promise<mKeyPair> {
    return (await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"],
    )) as unknown as mKeyPair;
}

export async function generateAESGCMEncryptedMessage(
    payloadText: string,
    subscription: WebPushData,
): Promise<{
    cipherText: ArrayBuffer;
    salt: string;
    publicServerKey: string;
}> {
    const salt = await generateSalt();
    const serverKeys = await generateServerKey();
    const exportedServerKey = (await crypto.subtle.exportKey(
        "jwk",
        serverKeys.publicKey,
    )) as unknown as JWK;
    const encryptionKeys = await generateEncryptionKeys(
        subscription,
        salt,
        serverKeys,
    );
    const contentEncryptionCryptoKey = await crypto.subtle.importKey(
        "raw",
        encryptionKeys.contentEncryptionKey,
        "AES-GCM",
        true,
        ["decrypt", "encrypt"],
    );

    const paddingBytes = 0;
    const paddingUnit8Array = new Uint8Array(2 + paddingBytes);
    const payloadUint8Array = stringToU8Array(payloadText);
    const recordUint8Array = new Uint8Array(
        paddingUnit8Array.byteLength + payloadUint8Array.byteLength,
    );
    recordUint8Array.set(paddingUnit8Array, 0);
    recordUint8Array.set(payloadUint8Array, paddingUnit8Array.byteLength);

    const encryptedPayloadArrayBuffer = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            tagLength: 128,
            iv: encryptionKeys.nonce,
        },
        contentEncryptionCryptoKey,
        recordUint8Array as webcrypto.BufferSource,
    );

    return {
        cipherText: encryptedPayloadArrayBuffer,
        salt: b64ToUrlEncoded(btoa(u8ToString(salt))),
        publicServerKey: b64ToUrlEncoded(
            exportPublicKeyPair(exportedServerKey),
        ),
    };
}

/**
 * Public-facing wrapper that renames the result fields to match the
 * `Encryption: salt=…` / `Crypto-Key: dh=…` headers each piece lands
 * in on the wire. Returns the encrypted record body plus the two
 * base64url header parameters.
 */
export async function encryptPayload(
    payloadText: string,
    subscription: WebPushData,
): Promise<{ body: ArrayBuffer; salt: string; dh: string }> {
    const encrypted = await generateAESGCMEncryptedMessage(
        payloadText,
        subscription,
    );
    return {
        body: encrypted.cipherText,
        salt: encrypted.salt,
        dh: encrypted.publicServerKey,
    };
}
