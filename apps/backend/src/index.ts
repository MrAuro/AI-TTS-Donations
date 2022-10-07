import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import { cheerEvent, subscriptionEvent } from "./typings";
const app = express();
dotenv.config();
const port = process.env.PORT || 4200;

// Notification request headers
const TWITCH_MESSAGE_ID = "Twitch-Eventsub-Message-Id".toLowerCase();
const TWITCH_MESSAGE_TIMESTAMP =
  "Twitch-Eventsub-Message-Timestamp".toLowerCase();
const TWITCH_MESSAGE_SIGNATURE =
  "Twitch-Eventsub-Message-Signature".toLowerCase();
const MESSAGE_TYPE = "Twitch-Eventsub-Message-Type".toLowerCase();

// Notification message types
const MESSAGE_TYPE_VERIFICATION = "webhook_callback_verification";
const MESSAGE_TYPE_NOTIFICATION = "notification";
const MESSAGE_TYPE_REVOCATION = "revocation";

// Prepend this string to the HMAC that's created from the message
const HMAC_PREFIX = "sha256=";

// next.js api base url
const API_URL = process.env.API_URL ?? "http://localhost:3000";
const SERVERLESS_PROCESSOR_URL =
  process.env.SERVERLESS_PROCESSOR_URL ?? "http://localhost:8080";

app.use(
  express.raw({
    // Need raw message body for signature verification
    type: "application/json",
  })
);

async function processEvent(broadcasterId: string, message: string) {
  const streamer = await axios.get(
    API_URL + "/api/streamers/streamerId/" + broadcasterId,
    {
      headers: { secret: process.env.API_SECRET ?? "" },
    }
  );

  const streamerJson = streamer.data as {
    message: string;
    streamer: {
      id: string;
      overlayId: string;
      ttsmessages: [];
      user: {
        id: string;
        name: string;
        email: string;
        emailVerified?: boolean;
        image: string;
      };
    };
  };
  console.log("STREAMER JSON", streamerJson);

  if (streamerJson) {
    console.log("EVENT MESSAGE???", message);
    console.log("STRAEMER OVERLAY?", streamerJson.streamer.overlayId);
    const serverlessRequest = await axios.post(SERVERLESS_PROCESSOR_URL, {
      message: message,
      overlayId: streamerJson.streamer.overlayId,
    });
    console.log("SERVERLESS REQUEST", serverlessRequest.data);
  } else {
    throw new Error("Streamer not found");
    // console.error("Streamer not found");
    // return;
  }
}

async function subscriptionCallback(event: subscriptionEvent) {
  await processEvent(event.broadcaster_user_id, event.message.text);
  console.log("subscriptionCallback", event);
}

async function cheerCallback(event: cheerEvent) {
  await processEvent(event.broadcaster_user_id, event.message);
  console.log("cheerCallback", event);
}

app.post("/eventsub", async (req, res) => {
  let secret = getSecret();
  let message = getHmacMessage(req);
  let hmac = HMAC_PREFIX + getHmac(secret, message); // Signature to compare

  if (true === verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
    console.log("signatures match");

    // Get JSON object from body, so you can process the message.
    let notification = JSON.parse(req.body);

    if (MESSAGE_TYPE_NOTIFICATION === req.headers[MESSAGE_TYPE]) {
      console.log(`Event type: ${notification.subscription.type}`);
      if (notification.subscription.type === "channel.subscription.message") {
        try {
          await subscriptionCallback(notification.event);
        } catch (e) {
          return res.status(500).send(e);
        }
      } else if (notification.subscription.type === "channel.cheer") {
        try {
          await cheerCallback(notification.event);
        } catch (e) {
          return res.status(500).send(e);
        }
      } else console.log(JSON.stringify(notification.event, null, 4));

      res.sendStatus(204);
    } else if (MESSAGE_TYPE_VERIFICATION === req.headers[MESSAGE_TYPE]) {
      res.status(200).send(notification.challenge);
    } else if (MESSAGE_TYPE_REVOCATION === req.headers[MESSAGE_TYPE]) {
      res.sendStatus(204);

      console.log(`${notification.subscription.type} notifications revoked!`);
      console.log(`reason: ${notification.subscription.status}`);
      console.log(
        `condition: ${JSON.stringify(
          notification.subscription.condition,
          null,
          4
        )}`
      );
    } else {
      res.sendStatus(204);
      console.log(`Unknown message type: ${req.headers[MESSAGE_TYPE]}`);
    }
  } else {
    console.log("403"); // Signatures didn't match.
    res.sendStatus(403);
  }
});

app.post("/newuser", async (req, res) => {
  // if bearer token not equal to process.env.secret
  const secret = req.headers.authorization?.split(" ")[1];
  const data = JSON.parse(req.body);
  if (secret !== process.env.API_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const [subscribeResub, subscribeCheers] = await Promise.all([
    axios.post(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        type: "channel.subscription.message",
        version: "1",
        condition: { broadcaster_user_id: data.streamerId },
        transport: {
          method: "webhook",
          callback: "https://eventsub.solrock.mmattdonk.com/eventsub",
          secret: process.env.API_SECRET,
        },
      },
      {
        headers: {
          "Client-Id": process.env.CLIENT_ID ?? "",
          Authorization: "Bearer " + process.env.TWITCH_ACCESS_TOKEN,
        },
      }
    ),
    axios.post(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        type: "channel.cheer",
        version: "1",
        condition: { broadcaster_user_id: data.streamerId },
        transport: {
          method: "webhook",
          callback: "https://eventsub.solrock.mmattdonk.com/eventsub",
          secret: process.env.API_SECRET,
        },
      },
      {
        headers: {
          "Client-Id": process.env.CLIENT_ID ?? "",
          Authorization: "Bearer " + process.env.TWITCH_ACCESS_TOKEN,
        },
      }
    ),
  ]);

  if (subscribeResub.status === 200 && subscribeCheers.status === 200) {
    res.status(200).send("OK");
  }
});

app.listen(port, () => {
  console.log(`@solrock/backend started at port ${port} 🎉`);
});

function getSecret() {
  // TODO: Get secret from secure storage. This is the secret you pass
  // when you subscribed to the event.

  // ahh!! leaked!! 😱
  return process.env.EVENTSUB_SECRET ?? "superdanksecretdotcom";
}

// Build the message used to get the HMAC.
function getHmacMessage(request: any) {
  return (
    request.headers[TWITCH_MESSAGE_ID] +
    request.headers[TWITCH_MESSAGE_TIMESTAMP] +
    request.body
  );
}

// Get the HMAC.
function getHmac(
  secret: crypto.BinaryLike | crypto.KeyObject,
  message: crypto.BinaryLike
) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

// Verify whether our hash matches the hash that Twitch passed in the header.
function verifyMessage(hmac: any, verifySignature: any) {
  return crypto.timingSafeEqual(
    Buffer.from(hmac),
    Buffer.from(verifySignature)
  );
}