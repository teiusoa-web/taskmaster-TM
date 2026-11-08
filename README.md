# TaskMaster

TaskMaster is a role based task management web app. Admins and managers create and assign work; users track assigned tasks, update checklists, discuss progress, and submit completion reports for review.

## Features

- Task lists, status filters, search, sorting, and Kanban view
- Task assignment, deadlines, priority, categories, checklists, comments, and activity
- Completion reports with admin approval or revision request
- Admin, manager, and user roles
- Account login, password recovery, email verification, and profile management
- Calendar and avatar/attachment uploads

## Requirements

- Node.js with npm
- Dependencies installed with `npm install`

## Run locally

```sh
npm install
npm run dev
```

Open the development URL printed by the startup script (normally `http://localhost:3000`). `npm run dev` starts the web/auth service, JSON Server for task/category data, and the upload service. Ports and service URLs can be configured with environment variables; see `.env.example` and `public/js/api-config.js`.

The first run creates an empty local account file if one is missing. There are no shared default credentials; create or provision an account for your own development environment. The auth server can print recovery/verification links to its console when SMTP is not configured.

To use email verification and password recovery, copy `.env.example` to `.env` and set your SMTP values. Keep `.env` local; it is excluded from Git.

## Data files

- `data/users.json` stores account profiles and password hashes.
- `data/database.json` stores local tasks and categories. It is initialized from the safe, empty `data/database.example.json` template when missing.
- `data/uploads/` stores uploaded files; `data/backups/` stores upload copies.

These JSON files are intended for a local prototype, not concurrent production use. Back up data before editing or resetting it.
Account records, the local task database, uploaded files, backups, and `.env` are excluded from Git. The checked-in database template contains no user data.

## Architecture and design documents

- [Software architecture](docs/SOFTWARE_ARCHITECTURE_DESIGN.md)
- [Workflows](docs/workflow.md)
- [Data design](docs/Database.md)
- [API reference](docs/API_DOCUMENT.md)

## Project layout

```text
public/           Browser pages and assets (HTML, CSS, JavaScript)
scripts/          Local Node.js web, authentication, and upload services
data/             Starter data plus local accounts and uploaded files
docs/             Architecture, workflow, data, and API documentation
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

## Free demo deployment on Render

1. Push this repository to GitHub.
2. In Render, create a **Blueprint** and select the GitHub repository. Render reads [`render.yaml`](render.yaml).
3. When prompted, set `ADMIN_USERNAME` (3 to 40 letters, numbers, `_`, `.`, or `-`) and `ADMIN_PASSWORD` (10 to 128 bytes). These values create the first admin account; do not commit them.
4. Deploy, wait for the build to finish, then open the `onrender.com` URL shown in Render.

This configuration is for a public demo. Render Free services sleep after 15 minutes without traffic and have ephemeral storage, so accounts, tasks, and uploaded files can disappear after a restart or sleep. The app's generic task API and upload endpoint also lack server-side user authorization. Avoid real or sensitive data; use a persistent database and authenticated backend before using it for real work.

## Deployment note

Task and category access rules currently run in browser code while JSON Server exposes generic CRUD routes. The upload service also does not require an authenticated session. Put data access and authorization behind a trusted backend before exposing the app to untrusted users or the public internet.

