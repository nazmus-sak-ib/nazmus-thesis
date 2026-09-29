# Publish this workspace

The workflow `.github/workflows/deploy-pages.yml` publishes pushes to the **page**
branch. It builds only the website into `web/dist`; it does not publish the
repository root, R scripts, or raw data elsewhere in the repository.

## One-time GitHub setup

1. Open https://github.com/nazmus-sak-ib/nazmus-thesis/settings/pages
2. Under Build and deployment, choose **GitHub Actions** as Source.
3. If Settings → Environments → github-pages restricts deployment branches,
   allow the **page** branch.
4. Commit and push the prepared changes to **page**.
5. In Actions, open **Publish model workspace**. Wait for build and deploy to
   finish. If you enabled Pages after a failed run, re-run that workflow.

Expected address: https://nazmus-sak-ib.github.io/nazmus-thesis/
Pages must be available under your repository/account plan. No PAT needs to be
added to the repository; deployment uses GitHub's built-in token.

## Future updates

- Save your current workspace to **web/public/workspace.json**.
- Put matching diagram/result pairs in **web/models** and **web/results**.
- Commit and push to **page**. The workflow rebuilds and republishes automatically.
- Keep backup/export staging files outside **web/public**, since everything in
  that directory is copied into the published website.
- Public files include the saved workspace (including notes), model images,
  and result JSONs. A hidden model on the canvas is still a public asset if built.

Fresh visitors load workspace.json; older projects without it fall back to
layout.json. Returning visitors retain their browser-local workspace edits.
To inspect the newly published starting layout without an existing browser copy,
use a private window or download the site's workspace.json and Open workspace.
Refresh library checks the deployed catalog; it cannot scan your local folders.
Visitor edits and Save workspace are local to their browser/computer; they do not
modify GitHub or other visitors' workspaces. Normal local development is unchanged.

## Local verification

In PowerShell, from the web directory:

```powershell
$env:PAGES_BASE_PATH = '/nazmus-thesis/'
npm run build
Remove-Item Env:PAGES_BASE_PATH
```

The workflow obtains the path from GitHub's Pages configuration. Local development
defaults to `/`. Publish the built `web/dist` artifact, never the raw JSX sources.
