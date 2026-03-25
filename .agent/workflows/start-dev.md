---
description: Start both backend and frontend dev servers with one command
---

## Start Development Servers

// turbo-all

1. Start both backend (port 5000) and frontend (port 3000) servers:

```
npm run dev
```

Run this from the project root `c:\SNIX\sify\prompts-v2`.

- **Backend**: Express server on `http://localhost:5000`
- **Frontend**: Next.js dev server on `http://localhost:3000`

Both servers will show colored output: blue for backend, green for frontend.

### Individual servers

- Backend only: `npm run dev:backend`
- Frontend only: `npm run dev:frontend`

### Install all dependencies

If node_modules are missing:

```
npm run install:all
```
