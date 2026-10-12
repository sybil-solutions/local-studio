# Google Workspace (Gmail + Calendar)

Local Studio gives agents **read-only** access to Gmail and Google Calendar. Nothing it does can send, delete, or edit mail or events.

## Using the release app

Release builds include Local Studio's own Google client. Open **Settings → Accounts → Gmail** (or Google Calendar), click **Continue with Google**, and approve the consent screen. That's it.

While Local Studio's consent screen is in Google's *testing* mode, only accounts on its test-user list can sign in, and Google expires the grant after about 7 days. If Google says the app is blocked or unverified for you, use your own client (below).

## Using your own Google client

Do this if you build Local Studio yourself, run it on a server, or want your own quota and consent screen. It takes about five minutes.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. **Enable the APIs:** *APIs & Services → Library* → enable **Gmail API** and **Google Calendar API**.
3. **Consent screen:** *Google Auth Platform → Branding* → fill in an app name and your email. Under **Audience**, choose *External* and add every Google account that will sign in as a **test user**.
4. **Data access:** add these scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`
5. **Create the client:** *Google Auth Platform → Clients → Create client* → application type **Desktop app**. Don't add a redirect URI; desktop clients accept any `127.0.0.1` port.
6. Copy the **client ID** and the **client secret**. The secret is shown only once. If you lose it, open the client and use **Add secret**.
7. In Local Studio, open the Gmail account dialog, click **Change**, paste both values, and click **Continue with Google**.

**The secret is required.** Google's token endpoint refuses Desktop-app clients without it (`client_secret is missing`), even though sign-in uses PKCE.

### Testing mode limits

- Only listed test users can sign in (up to 100).
- Google expires refresh tokens after about 7 days, so expect to reconnect weekly.
- Publishing the app removes both limits, but Gmail read access is a *restricted* scope, and Google requires a security review before it can be public.

## Running Local Studio on a server

Set the client on the service that runs the agent runtime, instead of pasting it into each browser:

```ini
# ~/.config/systemd/user/vllm-studio-frontend.service.d/google.conf
[Service]
Environment=LOCAL_STUDIO_GOOGLE_CLIENT_ID=<client id>
Environment=LOCAL_STUDIO_GOOGLE_CLIENT_SECRET=<client secret>
```

Then `systemctl --user daemon-reload && systemctl --user restart vllm-studio-frontend`.

Signing in when the browser is on another machine: Google's last step sends your browser to `http://127.0.0.1:<port>/callback`, which is your own computer, not the server. The page fails to load. That's expected. Copy the full address from the browser's address bar, paste it into the **Browser says it can't connect?** box in the dialog, and click **Finish**.

On a server, tokens are stored in `oauth-vault.local.json` (mode 0600) in the data directory. The desktop app encrypts them with the OS keychain instead.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `client_secret is missing` / `Client secret is required` | Save the client secret along with the ID. |
| `The provided client secret is invalid` | The secret doesn't match this client ID. Add a new secret in the console and save it. |
| `access_denied` / app blocked | Add the account as a test user on the consent screen. |
| `Google did not grant every required read-only scope` | Tick every checkbox on the consent screen. |
| Connection stops working after about a week | The consent screen is in testing mode. Reconnect. |
| `No Google sign-in is in progress` | The sign-in timed out or was replaced. Click Continue with Google again. |
