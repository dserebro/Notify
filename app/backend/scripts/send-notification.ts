async function notify(
    notifyApiUrl: string,
    message: {
        title: string;
        message: string;
        iconUrl?: string;
        tags?: string[];
    },
    serverKey: string | undefined = undefined
) {
    const headers: { [key: string]: string } = {
        "Content-Type": "application/json",
    };

    if (serverKey) {
        headers["Authorization"] = `Bearer ${serverKey}`;
    }

    const response = await fetch(notifyApiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
    });

    if (!response.ok) {
        const result = (await response.json()) as { error: { message: string } };
        throw new Error(result.error.message);
    }

    return response;
}

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
    const index = args.indexOf(name);
    if (index === -1 || index + 1 >= args.length) return undefined;
    return args[index + 1];
}

const title = getArg("--title") || getArg("-t");
const message = getArg("--message") || getArg("-m");
const icon = getArg("--icon") || getArg("-i");
const tags = getArg("--tags");
const remote = getArg("--remote") || getArg("-r") || "http://localhost:8787/api/notify";
const key = getArg("--key") || getArg("-k");

if (!title || !message) {
    console.error("Usage: bun run scripts/send-notification.ts --title <title> --message <message> [--icon <url>] [--tags <comma,separated>] [--remote <url>] [--key <api-key>]");
    process.exit(1);
}

await notify(
    remote,
    {
        title,
        message,
        iconUrl: icon,
        tags: tags ? tags.split(",") : [],
    },
    key
);
console.log("Notification sent");
