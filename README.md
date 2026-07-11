# Outreach Desk

A generic, static React/TypeScript outreach CRM backed by a Google Spreadsheet.

Each user can connect the same deployed frontend to a different spreadsheet. The connection URL and API token are saved only in that browser (or only for that browser session), while records, CRM status, import history and shared message settings live in Google Sheets.

## Features

- Guided first-run setup with links to the relevant Google tools and documentation
- Copy/download buttons for the supplied Google Apps Script backend
- Multiple remembered workspaces, plus temporary session-only workspaces
- Optional `.env.local` connection defaults for local development
- Google Sheets as the source of truth
- Shared application name, subtitle, default country and message template in a `Settings` sheet
- Incremental Apify imports: add new records, refresh existing data and preserve CRM fields
- Search and filters for city, category, status, favourites and phone type
- WhatsApp message generation, telephone, website and Google Maps actions
- CRM status, notes, contacted date and follow-up date
- Per-workspace browser cache for faster loading and limited offline viewing
- CSV export
- GitHub Pages deployment workflow

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite. The app will show the setup wizard when it has no saved connection.

## Optional `.env.local`

For local development, copy `.env.example` to `.env.local`:

```env
VITE_API_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
VITE_API_TOKEN=YOUR_PRIVATE_TOKEN
VITE_CONNECTION_NAME=Development workspace
```

`.env.local` is ignored by Git. Do not place a private token in a committed `.env` file or in GitHub Pages build variables: Vite variables are compiled into the public JavaScript bundle.

A workspace saved through the setup page takes precedence over the environment default.

## Google Sheets backend

The setup wizard explains the complete process inside the app. In outline:

1. Create an empty Google Spreadsheet.
2. Open **Extensions → Apps Script**.
3. Copy `apps-script/Code.gs` into the editor.
4. Run `setupProject()`.
5. Run `generateApiToken()` and copy the token from the execution log.
6. Deploy the script as a web app, executing as yourself, with browser-accessible permissions.
7. Paste the deployed `/exec` URL and token into the setup page.
8. Test the connection before saving it.

The setup wizard also serves copies of the backend files from `public/setup/`, so they remain available after deploying the frontend.

### Sheets created automatically

- `Venues` — imported business data and CRM fields
- `Imports` — one row per Apify import
- `Settings` — shared app name, subtitle, country code and message template

### Credential storage

- **Remember checked:** workspace URL, token and local label are stored in `localStorage` on that device.
- **Remember unchecked:** they are stored in `sessionStorage` and disappear when the browser session ends.
- Spreadsheet records and CRM fields are never stored only in the browser; Google Sheets remains authoritative.
- Cached data is namespaced by workspace ID, preventing one workspace cache from being shown in another.

This lightweight token model is appropriate for a personal/static tool containing public business data. It is not equivalent to server-side authentication. Avoid third-party scripts on the deployed frontend and rotate the token with `generateApiToken()` if it is exposed.

## Importing from Apify

Use a dataset-items URL such as:

```text
https://api.apify.com/v2/datasets/DATASET_ID/items?format=json&clean=true
```

Signed URLs are supported. The backend stores a redacted source URL in the `Imports` sheet.

Later imports are merged by `id`, `placeId`, `cid`, phone number, or finally `title + address`. Existing status, notes, favourites and follow-up dates are preserved.

## Multiple workspaces

A single frontend deployment can connect to several spreadsheets:

- use **Add workspace** in the footer or Settings;
- complete or skip through the setup guide;
- test and save the new connection;
- switch between remembered workspaces from the header.

Each workspace has its own Apps Script deployment and token.

## Build and deploy

```bash
npm run build
npm run preview
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for GitHub Pages instructions.

## Project layout

```text
apps-script/
  Code.gs
  appsscript.json
public/setup/
  Code.gs.txt
  appsscript.json
src/
  components/SetupWizard.tsx
  App.tsx
  api.ts
  styles.css
  types.ts
  utils.ts
.github/workflows/
  deploy-pages.yml
```

## Updating the Apps Script backend

After changing `apps-script/Code.gs`:

1. copy the change into the Apps Script editor;
2. in Apps Script choose **Deploy → Manage deployments**;
3. edit the deployment and select **New version**;
4. keep using the same `/exec` URL;
5. copy the same backend file to `public/setup/Code.gs.txt` before building the frontend.

## Data ownership

The frontend is static. It does not run a hosted database and does not proxy or retain user records. Google Sheets and the bound Apps Script project belong to the spreadsheet owner.
