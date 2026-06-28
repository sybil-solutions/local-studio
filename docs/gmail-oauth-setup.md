# Connect OAuth MCP providers

Local Studio can connect curated MCP servers without asking users to paste
provider tokens into plugin settings. Each provider is connected once in
**Settings -> Plugins -> Connections**. Local Studio stores the OAuth material
locally and injects fresh values into the managed MCP server at launch.

This guide covers the currently managed providers:

- **Google** for Gmail and Calendar.
- **GitHub** for repositories, issues, pull requests, and code search.
- **Hugging Face** for Hub models, datasets, Spaces, papers, and inference.

## Local Studio

1. Open Local Studio.
2. Go to **Settings -> Plugins -> Connections**.
3. For each provider, paste its OAuth client ID and client secret.
4. Click **Save client**.
5. Click **Connect** and finish the provider consent screen.
6. Go to **Plugins** and add the curated server if it was not installed by the
   connect flow.

The callback URL is shown by Local Studio if a provider is not configured yet.
For the dev server on port `3001`, the callbacks are:

```text
Google:       http://localhost:3001/api/oauth/google/callback
GitHub:       http://localhost:3001/api/oauth/github/callback
Hugging Face: http://localhost:3001/api/oauth/huggingface/callback
```

The packaged desktop app uses `http://127.0.0.1:<port>` and persists the port in
the app data directory so the origin stays stable across restarts. If a provider
requires an exact callback URL, use the URL Local Studio shows on that machine.

## Google for Gmail and Calendar

This is the only manual setup users do for Google. After consent, Local Studio
holds a long-lived refresh token and refreshes access tokens automatically.

Why this is stable:

- The OAuth client is type **Desktop app**. Google accepts loopback redirects
  such as `http://127.0.0.1:<port>` for Desktop clients without registered
  redirect URIs.
- The consent screen can stay in **Testing** with the user's Google account
  added as a test user. Do not publish the consent screen.
- Local Studio sends `access_type=offline` and `prompt=consent`, so Google
  returns a refresh token on the first consent.

### Google Cloud Console

1. Go to <https://console.cloud.google.com/>.
2. Use the project dropdown to create or select a project.
3. Enable the APIs:
   - Gmail: <https://console.cloud.google.com/apis/library/gmail.googleapis.com>
   - Calendar: <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
4. Open <https://console.cloud.google.com/apis/credentials/consent>.
5. Choose **External** and create the consent screen.
6. Set:
   - App name: `Local Studio`
   - User support email: the user's Google account
   - Developer contact email: the user's Google account
7. Add these scopes:

   ```text
   openid
   email
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/calendar
   ```

8. Add the same Google account as a test user.
9. Confirm the publishing status is **In testing**.
10. Open <https://console.cloud.google.com/apis/credentials>.
11. Create credentials with **OAuth client ID -> Desktop app**.
12. Name it `Local Studio`.
13. Copy the client ID and client secret into Local Studio's Google connection.

Do not create a Web client for Google. A Google Web client causes
`redirect_uri_mismatch` in the local loopback flow.

## GitHub

GitHub requires an OAuth app owned by the GitHub account or organization that
will authorize Local Studio.

1. Open <https://github.com/settings/developers>.
2. Choose **OAuth Apps -> New OAuth App**.
3. Set:
   - Application name: `Local Studio`
   - Homepage URL: `http://localhost:3001` for dev, or the Local Studio origin
     shown in the setup page.
   - Authorization callback URL: the exact GitHub callback URL shown by Local
     Studio, for example `http://localhost:3001/api/oauth/github/callback`.
4. Register the app.
5. Generate a client secret.
6. Copy the client ID and client secret into Local Studio's GitHub connection.
7. Click **Connect** and approve the requested scopes.

Local Studio requests `repo`, `read:org`, and `read:user`, then injects the
connected token as `GITHUB_PERSONAL_ACCESS_TOKEN` for the GitHub MCP server.

## Hugging Face

Hugging Face requires an OAuth app in the user's Hugging Face account settings.

1. Open <https://huggingface.co/settings/applications>.
2. Create a new OAuth application.
3. Set:
   - Application name: `Local Studio`
   - Redirect URI: the exact Hugging Face callback URL shown by Local Studio,
     for example `http://localhost:3001/api/oauth/huggingface/callback`.
4. Save the app.
5. Copy the client ID and client secret into Local Studio's Hugging Face
   connection.
6. Click **Connect** and approve the requested scopes.

Local Studio requests `openid`, `profile`, `email`, `read-repos`, and
`inference-api`, then injects the connected token as `HF_TOKEN` for the Hugging
Face MCP server.

## What Other Users Need

Every user needs their own OAuth apps unless Local Studio ships a hosted,
verified OAuth broker or a bundled public client for that provider. The local
app cannot safely reuse another user's client secret, and provider dashboards
generally bind OAuth apps to the account or organization that owns them.

The per-user path is:

1. Install Local Studio.
2. Open **Settings -> Plugins -> Connections**.
3. Use the callback URL shown there to create provider OAuth apps.
4. Save each provider's client ID and client secret locally.
5. Click **Connect** once per provider.
6. Add the curated MCP servers: GitHub, Gmail, Calendar, and Hugging Face.

For a smoother product experience, Local Studio could later add a hosted
OAuth broker. In that model, users would only click **Connect**, the broker
would hold the verified provider clients, and Local Studio would receive local
tokens after consent. That is a product and security deployment, not something
the local-only app can fake with static docs.

## If Something Breaks

- **Google `redirect_uri_mismatch`**: the Google client was created as Web
  instead of Desktop. Delete it and create a Desktop app client.
- **Google `access_denied` or unverified app**: add the signing-in account as
  a test user and keep the consent screen in Testing.
- **GitHub or Hugging Face callback mismatch**: update the provider app's
  callback URL to the exact URL shown by Local Studio.
- **Connected server still launches with blank token env**: open
  **Settings -> Plugins -> Connections** and confirm the provider says
  **connected**. Then reconnect or restart Local Studio so managed tokens are
  injected into the MCP server config before launch.
