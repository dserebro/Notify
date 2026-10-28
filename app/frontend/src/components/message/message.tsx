import type { FunctionalComponent } from "preact";
import Chips from "preact-material-components/Chips";
import "preact-material-components/Chips/style.css";
import Elevation from "preact-material-components/Elevation";
import "preact-material-components/Elevation/style.css";
import "preact-material-components/Theme/style.css";
import { useEffect, useState } from "preact/hooks";
import { format } from "timeago.js";
import type { MessageType } from "../../types/messagetype";
import style from "./message.module.css";

type MessageProps = {
    message: MessageType;
};

function timestampToString(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

const Message: FunctionalComponent<MessageProps> = ({
    message,
}: MessageProps) => {
    const [receiveTimeStamp, setReceiveTimestamp] = useState(
        format(message.receivedAt),
    );

    useEffect(() => {
        setReceiveTimestamp(format(message.receivedAt));
        const id = setInterval(
            () => setReceiveTimestamp(format(message.receivedAt)),
            1000,
        );
        return () => clearInterval(id);
    }, [message, setReceiveTimestamp]);

    // todo:
    // - add a delete button
    // - add a read status indicator
    // - add a show more option on to many tags

    return (
        <div>
            <Elevation z={1}>
                <div class={style.message}>
                    <h1 class={style.messagetitle}>{message.title}</h1>
                    <p
                        class={style.messagetime}
                        title={timestampToString(message.receivedAt)}
                    >
                        {receiveTimeStamp}
                    </p>
                    <div class={style.messagebody}>{message.body}</div>
                    {
                        // preact-material-components' typings for Chip/Chips
                        // demand exact child subclasses; we only render the
                        // standard Text child.
                        <Chips class={style.messagetags}>
                            {message.tags.map(
                                (tag: string) =>
                                    (
                                        <Chips.Chip key={tag}>
                                            {
                                                (
                                                    <Chips.Text>
                                                        {tag}
                                                    </Chips.Text>
                                                ) as unknown as never
                                            }
                                        </Chips.Chip>
                                    ) as unknown as never,
                            )}
                        </Chips>
                    }
                    {message.icon && (
                        <img
                            class={style.messageimage}
                            src={message.icon}
                            alt={message.title}
                        />
                    )}
                </div>
            </Elevation>
        </div>
    );
};

export default Message;
