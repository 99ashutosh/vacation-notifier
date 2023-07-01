const fs = require("fs").promises;
const path = require("path");
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

// If modifying these scopes, delete token.json.
const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    console.log(
      "Using previous OAuth session details, please delete the token.json file to start fresh."
    );
    console.log(
      "----------------------------------------------------------------------------------------"
    );
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  console.log("Please login with browser!");
  console.log("----------------------------------");
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  console.clear();
  console.log("Logged In with OAuth credentials!");
  console.log("----------------------------------");
  return client;
}

/**
 * Check if the account has a "vacation" label, if not make one.
 * @param {} auth 
 * @returns 
 */
async function makeVacationLabel(auth) {
  const date_time = new Date();
  console.log("Fetch time: ", date_time);
  console.log("Checking if a label exists...");
  const gmail = google.gmail({ version: "v1", auth });

  const listLabels = gmail.users.labels.list({ userId: "me" });

  const labels = JSON.parse(JSON.stringify((await listLabels).data.labels));

  let labelID = "";

  if (labels.find((data) => data.name === "vacation")) {
    console.log("Label Exists!");
    labelID = labels.find((data) => data.name === "vacation")["id"]
    
  } else {
    const res = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
        name: "vacation",
      },
    });
    labelID = await res.data.id;
  }
  return [auth, labelID];
}
/**
 * Get the number of messages in a thread
 * @param {*} auth 
 * @param {*} threadid 
 * @returns 
 */
async function getMessageCount(auth, threadid) {
  const gmail = google.gmail({ version: "v1", auth });
  return await gmail.users.threads
    .get({
      userId: "me",
      id: threadid,
    })
    .then((userThread) => {
      return userThread.data.messages.length;
    });
}

/**
 * Finds and captures the thread ids of mails that are new
 * @param {*} auth
 * @returns auth info and new mail thread ids
 */
async function findNewEmails(chainData) {
  const auth = chainData[0];
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.threads.list({
    userId: "me",
    maxResults: 10000,
    q: "is:unread",
  });

  // List to store all the threads of first time senders
  let newSenders = [];

  try {
    for(let thread of res.data.threads){
      if (await getMessageCount(auth, thread["id"]) === 1) {
        newSenders.push(thread["id"]);
      }
    };
  } catch (err) {
    newSenders = [];
  }

  return [ auth, chainData[1], newSenders];
}

/**
 * Send a vacation mail to all the unread mail
 * @param {*} sendData
 * @returns
 */
async function sendVacationReply(sendData) {
  const auth = sendData[0];
  const labelId = sendData[1];
  // console.log(labelId)
  const newSenders = sendData[2];
  const gmail = google.gmail({ version: "v1", auth });

  if (newSenders.length === 0) {
    console.log("No new mail recieved!")
    return;
  } else {
    console.log("%d mail(s) recieved! Sending Responses...", newSenders.length)
    try {
      newSenders.map(async (id) => {
        const messageFromThread = await gmail.users.threads.get({
          userId: "me",
          id: id,
        });

        const emailHeaders = JSON.parse(
          JSON.stringify(messageFromThread.data.messages[0].payload.headers)
        );

        // Store the Message-ID of a thread, to email address and subject name
        // Accorrding to docs, the Subject must be the same as the thread and 
        // the In-Reply-To header must be seRt
        let inReplyTo = "";
        let toEmailAddress = "";
        let subject = "";
        emailHeaders.forEach((data) => {
          if (data.name === "Message-ID") {
            inReplyTo = data.value;
          } else if (data.name === "From") {
            toEmailAddress = data.value;
          } else if (data.name === "Subject") {
            subject = data.value;
          }
        });

        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString(
          "base64"
        )}?=`;

        const messageParts = [
          `To: ${toEmailAddress}`,
          `In-Reply-To: ${inReplyTo}`,
          `References: ${inReplyTo}`,
          "Content-Type: text/html; charset=utf-8",
          "MIME-Version: 1.0",
          `Subject: ${utf8Subject}`,
          "",
          "On Vacation! 😎",
        ];

        const message = messageParts.join("\n");

        // For API, convert to Base64
        const raw = Buffer.from(message)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const req = gmail.users.messages.send({
          userId: "me",
          labelIds: [labelId],
          requestBody: { raw: raw, threadId: id },
        });

        // Once Reply is senb mark as read and add the vacation label
        const fixRead = gmail.users.threads
          .modify({
            userId: "me",
            id: id,
            removeLabelIds: ["UNREAD"],
            addLabelIds: [labelId],
          })
          .then(console.log("Sent Vacation Mails to All!"));
      });
    } catch (err) {
      console.log("Error!");
    }
  }
}

// main
console.clear();
authorize()
  .then(makeVacationLabel)
  .then(findNewEmails)
  .then(sendVacationReply)
  .catch(console.error);

setInterval(async () => {
  authorize()
    .then(makeVacationLabel)
    .then(findNewEmails)
    .then(sendVacationReply)
    .catch(console.error);
}, 60 * 1000);
