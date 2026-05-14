# Agentic Prompt DB

A split architecture application for managing and implementing code modification prompts using AI — with multi-agent swarm orchestration and real-time streaming.

## Features

- **Prompt Management** — Scan codebases, auto-generate NLP & Developer prompts per file section
- **AI Implementation** — Stream code changes in real-time via SSE, preview diffs, apply or rollback
- **Stop Generation** — Abort long-running implementation streams mid-flight with one click
- **Swarm Mode** — Multi-agent orchestration (Architect → Specialist agents) for complex changes
- **RuFlo MCP Bridge** — 239+ tool integration via JSON-RPC HTTP bridge
- **Change History** — Track all modifications with full undo/rollback support
- **Multi-Project** — Manage multiple codebases from a single dashboard
- **Dark/Light Theme** — Full theme support across all views
- **JWT Auth** — Secure authentication with token refresh
- **Docker Ready** — One-command deployment with Docker Compose

## Architecture

```
prompts-v2/
├── backend/          # Node.js + Express + Prisma + SQLite
│   ├── src/
│   │   ├── index.js          # Main Express server
│   │   ├── lib/              # Utilities (prisma, fileOps, syntaxValidator, etc.)
│   │   ├── llm/              # LLM adapters (InfinitAI)
│   │   ├── middleware/       # Auth middleware
│   │   └── routes/           # API route handlers (implement, ruflo, etc.)
│   ├── scripts/              # RuFlo MCP HTTP bridge launcher
│   ├── templates/            # Prompt templates (architect, specialist, etc.)
│   ├── prisma/schema.prisma  # Database schema
│   ├── Dockerfile
│   └── .env.example          # Environment variable template
│
├── frontend/         # Next.js UI application
│   ├── src/
│   │   ├── app/              # Pages (home, dashboard, prompt/[id], chats, etc.)
│   │   ├── components/       # Shared components (ThemeToggle, ProfilePanel, etc.)
│   │   ├── contexts/         # React contexts (DashboardMode, etc.)
│   │   └── lib/              # API client
│   └── Dockerfile
│
├── docker-compose.yml
└── package.json              # Root scripts for all services
```

## Quick Start

You have **two options** to run the project:

---

### Option 1: Local Development (`npm run dev`)

Best for active development with hot-reload.

```bash
# 1. Install all dependencies
npm run install:all

# 2. Set up environment
cp backend/.env.example backend/.env
# Edit backend/.env with your InfinitAI API key

# 3. Generate Prisma client & create database
cd backend && npx prisma generate && npx prisma db push && cd ..

# 4. Start all services (backend + frontend + RuFlo MCP)
npm run dev
```

---

### Option 2: Docker (`docker compose up`)

Best for quick setup, testing, or deployment on other machines.

```bash
# 1. Set up environment
cp backend/.env.example backend/.env
# Edit backend/.env with your InfinitAI API key

# 2. Build and start containers
npm run docker:up

# View logs
npm run docker:logs

# Stop containers
npm run docker:down

# Rebuild from scratch (after code changes)
npm run docker:build
```

---

### Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **RuFlo MCP Bridge**: http://localhost:8100
- **Health Check**: http://localhost:5000/api/health

## Environment Variables

### Backend (`backend/.env`)

```env
DATABASE_URL="file:./dev.db"
PORT=5000

JWT_SECRET=change-this-to-a-secure-random-string
JWT_EXPIRES_IN=24h

LLM_PROVIDER=infinitai
INFINITAI_API_KEY=your-api-key-here
INFINITAI_BASE_URL=https://your-infinitai-endpoint/maas/v1
INFINITAI_MODEL=meta/llama-3.3-70b-instruct
```

### Frontend (`frontend/.env.local` — optional)

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
```

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + frontend + RuFlo MCP locally (hot-reload) |
| `npm run install:all` | Install dependencies for both backend and frontend |
| `npm run docker:up` | Build and start Docker containers |
| `npm run docker:down` | Stop Docker containers |
| `npm run docker:logs` | Stream logs from Docker containers |
| `npm run docker:build` | Rebuild Docker images from scratch |

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register a new user |
| POST | `/api/auth/login` | No | Login and get JWT token |
| POST | `/api/auth/verify` | Yes | Verify JWT token |
| GET | `/api/pages` | Yes | Get all pages with sections and prompts |
| GET | `/api/prompts` | Yes | Get prompts filtered by pageId/section |
| POST | `/api/seed` | No | Scan project and seed database |
| POST | `/api/save` | Yes | Save prompt file content |
| GET | `/api/projects/user/:userId` | Yes | Get user's projects |
| POST | `/api/projects` | Yes | Create a new project |
| POST | `/api/implement/stream` | No | Generate code changes (SSE stream) |
| POST | `/api/implement/apply` | No | Apply confirmed changes |
| POST | `/api/implement/undo` | No | Rollback changes |
| GET | `/api/implement/changes/:pageId` | No | Get change history for a page |
| DELETE | `/api/implement/changes/:id` | No | Delete a change history entry |
| POST | `/api/chat` | No | Chat with InfinitAI |
| GET | `/api/code/:pageId` | Yes | Get source code for a page |
| POST | `/api/code/:pageId` | Yes | Save source code changes |
| POST | `/api/generate-prompts` | No | Generate prompts from source code via LLM |
| GET | `/api/health` | No | Health check |

## Database

Uses **SQLite** (via Prisma ORM) — zero installation required. The database file is auto-created at `backend/prisma/dev.db`.

### Models

- **User** — Authentication and project ownership
- **Project** — Multi-project support with filesystem paths
- **Page** — Code files being tracked
- **Section** — Logical sections within a file
- **Prompt** — Modification templates (NLP and Developer types)
- **ImplementHistory** — Change tracking and undo support
- **ChangeRequest** — User change request history

## Key Features Detail

### Stop Generation
When running an implementation, a **Stop** button (red) replaces the Run button. Clicking it aborts the SSE stream via `AbortController`, immediately halting the AI generation and freeing resources.

### Swarm Mode
Three modes available via the gear icon:
- **Normal** — Single-agent implementation
- **Ask** — Prompts before using multi-agent
- **Always** — Auto-routes complex changes through Architect → Specialist agent pipeline

### RuFlo MCP Bridge
A JSON-RPC HTTP bridge exposing 239+ tools for advanced code operations. Runs on port 8100 and auto-connects with the backend on startup.
