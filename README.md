# Agentic Prompt DB

A split architecture application for managing and implementing code modification prompts using AI.

## Architecture

```
prompts-v2/
├── backend/          # Node.js + Express + Prisma + SQLite
│   ├── src/
│   │   ├── index.js          # Main Express server
│   │   ├── lib/              # Utilities (prisma, fileOps, etc.)
│   │   ├── llm/              # LLM adapters (InfinitAI)
│   │   ├── middleware/       # Auth middleware
│   │   └── routes/           # API route handlers
│   ├── prisma/schema.prisma  # Database schema
│   ├── Dockerfile
│   └── .env.example          # Environment variable template
│
├── frontend/         # Next.js UI application
│   ├── src/
│   │   ├── app/              # Pages (home, dashboard, chats, etc.)
│   │   ├── components/       # Shared components
│   │   ├── contexts/         # React contexts
│   │   └── lib/              # API client
│   └── Dockerfile
│
├── docker-compose.yml
└── package.json              # Root scripts for both options
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

# 4. Start both servers (backend + frontend)
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
| `npm run dev` | Start backend + frontend locally (hot-reload) |
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
| POST | `/api/chat` | No | Chat with InfinitAI |
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
