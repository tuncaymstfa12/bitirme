# Repository Guidelines

## Project Structure & Module Organization
This is a Vite-based vanilla JavaScript SPA. Application entry starts at `src/app.js`, which wires hash-based navigation and renders the main views.

- `src/data/`: state and domain models (`store.js`, `models.js`, `auth.js`)
- `src/engine/`: scheduling, priority, rescheduling, and analytics logic
- `src/ui/`: screen renderers and reusable UI helpers
- `src/styles/`: global stylesheet in `main.css`
- `src/assets/` and `public/`: static images and icons

There is currently no `tests/` directory.

## Build, Test, and Development Commands
- `npm install`: install dependencies
- `npm run dev`: start the Vite dev server for local development
- `npm run build`: create a production build
- `npm run preview`: serve the production build locally

No dedicated test or lint scripts are configured in `package.json` at the moment.

## Coding Style & Naming Conventions
Use ES modules and keep files focused on one responsibility. Follow the existing style:

- 2-space indentation
- semicolons enabled
- single quotes for strings
- `camelCase` for variables and functions
- `PascalCase` is not used for files; prefer descriptive lower camel or compound names like `scheduleView.js`

Keep UI modules in `src/ui/`, pure business logic in `src/engine/`, and persistence/state concerns in `src/data/`.

## Testing Guidelines
There is no automated test suite yet. Before opening a PR, verify changes manually through `npm run dev` and exercise the affected flows:

- exam/topic creation
- schedule generation and rescheduling
- analytics rendering
- settings import/export

If you add tests, prefer lightweight unit tests for `src/engine/` and `src/data/`, and name them after the target module, for example `scheduler.test.js`.

## Commit & Pull Request Guidelines
Recent commits use short, imperative subjects, for example:

- `Add local authentication module`
- `Initial commit: add comprehensive .gitignore and project files`

Keep commit titles concise and action-oriented. For pull requests, include:

- a short summary of the change
- affected screens or modules
- manual verification steps
- screenshots or GIFs for UI changes

## Architecture Notes
This project is fully client-side and persists state in `localStorage`. Treat schema changes in `store.js` and `auth.js` carefully, since they affect existing browser data.
