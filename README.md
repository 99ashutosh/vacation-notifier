# vacation-notifier

Let your senders know you are on vacation!

## Running the Project

### Prerequisite: Make new OAuth 2.0 Client ID

Please refer [here](https://developers.google.com/gmail/api/quickstart/nodejs#set_up_your_environment) on how to make a new ID.

In the "Authorised redirect URIs" section add this URI:

```
http://localhost:3000/oauth2callback
```

Please install [`nodejs`](https://nodejs.org/en/download). Version does not matter.

Go to the root folder and run:

```
npm install
```

and then:

```
node .
```

## Technologies Used

- `node` to run the application.
- `google-cloud/local-auth` for `OAuth` authentication.
- `googleapis` to interract with the GMail API