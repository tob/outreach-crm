# Deployment

## 1. Verify locally

```bash
npm install
npm run build
npm run preview
```

The production output is written to `dist/`.

## 2. Create a GitHub repository

From the project directory:

```bash
git init
git add .
git commit -m "Initial Outreach Desk"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Do not commit `.env.local`.

## 3. Enable GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`.

In GitHub:

1. open **Settings → Pages**;
2. under **Build and deployment**, choose **GitHub Actions**;
3. open the **Actions** tab and confirm that “Deploy to GitHub Pages” succeeds;
4. use the Pages URL shown by the completed deployment.

The Vite configuration uses relative assets, so it works for both a root Pages site and a project Pages path.

## 4. Connect a spreadsheet

Open the deployed app. The guided setup page provides:

- a button to create a new Google Sheet;
- links to Google’s official Apps Script guides;
- copy/download buttons for `Code.gs` and the optional manifest;
- exact instructions for `setupProject()` and `generateApiToken()`;
- deployment instructions and `/exec` URL validation;
- connection testing before credentials are saved.

## 5. Public frontend and private token

Do not inject `VITE_API_TOKEN` into a public GitHub Pages build. Every Vite environment variable is visible in the built frontend.

For a public deployment, each user should enter their Apps Script URL and token through the setup page. Those values remain in that browser’s localStorage or sessionStorage.

## 6. Updating the app

Push changes to `main`:

```bash
git add .
git commit -m "Describe the change"
git push
```

The GitHub Actions workflow rebuilds and redeploys the site.

## 7. Updating Apps Script

Frontend deployment does not update Google Apps Script automatically.

After editing `apps-script/Code.gs`:

1. paste the new code into the spreadsheet’s Apps Script project;
2. choose **Deploy → Manage deployments**;
3. edit the web-app deployment;
4. select **New version** and deploy;
5. retain the same `/exec` URL unless you intentionally create a separate deployment.
