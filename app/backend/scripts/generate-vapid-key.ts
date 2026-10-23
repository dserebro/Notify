async function generateVapidKey(): Promise<string> {
    const key = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
    );
    const serverKey = await crypto.subtle.exportKey("jwk", key.privateKey);
    const serverKeyString = JSON.stringify(serverKey, null, 0);
    const vapidKey = btoa(serverKeyString);
    return vapidKey;
}

const vapidKey = await generateVapidKey();
console.log(vapidKey);
