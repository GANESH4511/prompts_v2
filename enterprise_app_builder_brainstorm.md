# 🧠 Brainstorm: Enterprise App Builder for Non-Techies

> **Session Date**: March 20, 2025
> **Status**: IN PROGRESS — paused after Wizard UX design
> **Next Step**: Agent Pipeline architecture + Pattern Library inventory

---

## Table of Contents

1. [Problem Definition](#1-problem-definition)
2. [Decisions Made](#2-decisions-made)
3. [Rejected Approaches](#3-rejected-approaches)
4. [Chosen Architecture: Pattern Composer](#4-chosen-architecture-enterprise-pattern-composer)
5. [Wizard UX Design](#5-wizard-ux-design)
6. [Remaining Work](#6-remaining-work-to-design)

---

## 1. Problem Definition

### The Vision
Build a platform where **non-technical people** can build **enterprise-grade, production-ready applications** by describing what they want — and get a complete, deployable codebase.

### Why Existing Tools Fail

| Tool | Problem |
|------|---------|
| **Bolt.new** | Produces demo/toy-quality code. No real DB, no auth, no tests. |
| **Lovable.dev** | Pretty UI, shallow code. Not production-deployable. |
| **v0.dev** | UI only, no backend. |
| **Bubble.io** | No real code ownership. Limited customization. |
| **Replit Agent** | Locked to ecosystem. Not enterprise-grade. |

### The Gap in the Market
> "I want a restaurant booking app" →
> - **Bolt/Lovable give you**: Pretty UI + fake data + localStorage
> - **This platform gives you**: Proper DB schema + auth + RBAC + API validation + error handling + tests + Docker + CI/CD

### Enterprise-Grade Means:

| Aspect | What Enterprise Requires |
|--------|--------------------------|
| Database | Proper schema, migrations, indexes, relationships, seed data |
| Auth | RBAC, JWT/sessions, refresh tokens, password reset flows |
| API | Validation (Zod), error handling, rate limiting, pagination |
| Security | CSRF, XSS prevention, input sanitization, CORS |
| Testing | Unit + Integration + E2E test suites |
| DevOps | Docker, CI/CD pipeline, env management, monitoring |
| Edge cases | Error states, loading states, empty states, offline handling |

---

## 2. Decisions Made

### ✅ Confirmed Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| **Target Users** | Non-techies: business owners (A), team members (B), project managers (C) | All three use cases |
| **Use Cases** | Build from scratch + Modify existing + Describe features | Full lifecycle |
| **LLM** | Claude (future) | User will invest in Claude later. Design for capable model. |
| **Tech Stack for Generated Apps** | Next.js 15 (App Router) + API Routes + Prisma + PostgreSQL | Stack 1 chosen. Start with one stack, add more later. |
| **Interaction Model** | Guided Wizard (primary) + Conversational (secondary) | User loves the wizard approach |
| **Wizard UX** | "AI Fills, User Confirms" — NOT a questionnaire | Avoids user frustration. See Section 5. |
| **Platform Purpose** | Internal team tool first, SaaS later | Simplifies initial scope |
| **Web First** | Web apps first, mobile later | Focus initial effort |
| **NOT a visual builder** | Not drag-and-drop like Bubble | Code generation, not visual editor |
| **Sunk Cost** | Willing to scrap prompts-v2 entirely | Evaluate purely on what achieves the goal best |
| **Architecture** | Hybrid: Pattern Library + Multi-Agent Pipeline | Guarantees quality + provides flexibility |

### ✅ Tech Stack Options for Users

The wizard offers users a choice of 3 stacks (initial focus on Stack 1):

| Stack | Frontend | Backend | Database | Best For |
|-------|----------|---------|----------|----------|
| **Stack 1 (CHOSEN)** | Next.js 15 (App Router) | Next.js API Routes | Prisma + PostgreSQL | Full-stack web apps, dashboards |
| Stack 2 (future) | React + Vite | Express.js + Node | Prisma + PostgreSQL | Separated frontend/backend |
| Stack 3 (future) | Next.js 15 | Supabase (BaaS) | Supabase (Postgres) | Rapid prototyping |

---

## 3. Rejected Approaches

### ❌ Ruflo (Enterprise AI Orchestration)
**Reason**: Ruflo is a developer productivity tool (CLI-based, requires Claude Pro $200+/mo). It solves a DIFFERENT problem (developer coordination) vs. the user's problem (non-techie empowerment). Non-techies can't use a CLI.

### ❌ prompts-v2 (Current Project)
**Reason**: It's a code MODIFICATION tool (scan → describe → edit). Cannot build apps from scratch (Use Case A). The SEARCH/REPLACE pipeline is clever but solves a sub-problem. The concept of "scan existing code → allow changes" IS useful for the "Modify" mode and can be integrated.

### ❌ Approach A: Pure Blueprint Engine
**Reason**: Too rigid. Limited to app types with pre-built blueprints. HUGE upfront work per blueprint. Doesn't serve the "any app type" flexibility requirement.

### ❌ Approach C: MCP-Powered Real Builder
**Reason**: User said "this is for my internal team, option C has no use." Also: too complex, heavy external dependencies (Supabase MCP, Vercel MCP), MCP ecosystem still young. Can be added later.

### ❌ Pure "Magic Prompt" UX (like Bolt.new)
**Reason**: Not enough context → demo-quality output. This is exactly the problem the user is trying to solve. Rich context = rich output.

### ❌ 8-Step Questionnaire Wizard
**Reason**: User correctly identified this causes frustration. Replaced with "AI Fills, User Confirms" approach where AI generates the full spec from 2-3 sentences and user only reviews/tweaks.

---

## 4. Chosen Architecture: "Enterprise Pattern Composer"

### Core Insight
> **"Patterns handle the 70% that's always the same. Agents handle the 30% that's unique."**

Think of it like **LEGO**:
- LEGO Bricks = Enterprise Patterns (guaranteed quality, pre-tested)
- LEGO Builder = AI Agents (select, arrange, customize)
- Building Instructions = Wizard Specification (rich context)

### Full Architecture (5 Layers)

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: GUIDED WIZARD + CONVERSATIONAL                    │
│  ════════════════════════════════════════                    │
│  - User types 2-3 sentences describing the app              │
│  - AI generates complete specification with smart defaults   │
│  - User reviews collapsible sections, edits what they want   │
│  - Chat box at bottom for "Anything else?"                  │
│  Outputs: Rich JSON Specification (50+ data points)         │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: SPECIFICATION ENGINE                              │
│  ════════════════════════════                                │
│  Converts wizard output into formal technical spec:         │
│  • Data model (entities, fields, relationships)             │
│  • Permission matrix (who can do what)                      │
│  • API contract inventory                                   │
│  • Page/screen inventory                                    │
│  • Business rules (formalized)                              │
│  Outputs: Structured JSON artifacts                         │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: PATTERN LIBRARY (Quality Guarantee)               │
│  ══════════════════════════════════════════                  │
│  Pre-built, pre-tested enterprise code patterns:            │
│                                                             │
│  📦 auth-pattern/         JWT, bcrypt, RBAC, auth routes    │
│  📦 database-pattern/     Prisma client, base schema,       │
│                           migration utils                   │
│  📦 api-pattern/          Error handler, Zod validator,     │
│                           pagination, rate limiter          │
│  📦 frontend-pattern/     Layout shell, form builder,       │
│                           data table, toast notifications   │
│  📦 testing-pattern/      Jest setup, fixtures, helpers     │
│  📦 devops-pattern/       Docker, CI/CD, env management     │
│  📦 logging-pattern/      Structured logs, error tracking   │
│                                                             │
│  These are YOUR code. Pre-tested. Never AI-generated.       │
│  This is what makes output ENTERPRISE-GRADE.                │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 4: AGENT PIPELINE (Customization & Flexibility)      │
│  ═════════════════════════════════════════════════           │
│  Each agent receives: Spec + Relevant Patterns              │
│                                                             │
│  🤖 ARCHITECT AGENT                                         │
│     → Folder structure + pattern selection                  │
│                                                             │
│  🤖 DATABASE AGENT                                          │
│     → Complete schema.prisma with custom models             │
│     → EXTENDS base-schema.prisma (never replaces)           │
│                                                             │
│  🤖 API AGENT                                               │
│     → Route files with CRUD + custom business logic         │
│     → USES error-handler, validator from patterns           │
│                                                             │
│  🤖 FRONTEND AGENT                                          │
│     → Pages and components                                  │
│     → USES layout-shell, data-table, form-builder           │
│                                                             │
│  🤖 BUSINESS LOGIC AGENT                                    │
│     → Custom service functions, middleware                  │
│     → ONLY agent generating truly novel code                │
│                                                             │
│  🤖 TESTING AGENT → Unit + integration tests               │
│  🤖 DEVOPS AGENT → Docker, CI/CD configs                   │
│                                                             │
│  [DESIGN NOT YET DETAILED — see Section 6]                  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 5: ASSEMBLY + VALIDATION                             │
│  ═══════════════════════════════                             │
│  • Combine patterns + agent outputs into final project      │
│  • Run ESLint / TypeScript checks                           │
│  • Run generated tests                                      │
│  • Verify imports and dependencies resolve                  │
│  • Output: Ready-to-run project folder                      │
│  [DESIGN NOT YET DETAILED — see Section 6]                  │
└─────────────────────────────────────────────────────────────┘
```

### Why This Architecture Guarantees All Three Requirements:

| Requirement | How It's Achieved |
|-------------|-------------------|
| **✅ Guaranteed Quality** | Pattern Library — YOUR pre-tested code. Auth, error handling, validation are NEVER AI-generated. Battle-tested. |
| **✅ Scalability** | Agents handle ANY app type. No pre-built "restaurant" blueprint needed. Agents read spec → generate custom code. |
| **✅ Flexibility** | Business Logic Agent handles custom requirements. "24hr cancellation policy" → custom middleware function. |

### Modify Mode (Existing Apps — Use Cases B & C)

The prompts-v2 SEARCH/REPLACE concept is useful here:

```
MODIFY MODE:
1. Point to existing project folder
2. System scans → understands structure
3. Wizard asks: "What do you want to change?"
4. Agent generates SEARCH/REPLACE patches
5. User previews diff → applies
```

This is prompts-v2 but cleaner — no separate NLP/Developer prompts, just "understand → change → apply".

---

## 5. Wizard UX Design

### Core UX Principle: "AI Fills, User Confirms"

> Instead of the wizard being a QUESTIONNAIRE (you ask, they answer), the AI generates the ENTIRE specification from 2-3 sentences. User only reviews and tweaks.

### The Two-Step Flow:

**Step 1: User Input (30 seconds)**
```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Describe your app:                                 │
│  ┌───────────────────────────────────────────────┐  │
│  │ A restaurant table booking system where       │  │
│  │ customers can reserve tables online and       │  │
│  │ restaurant staff can manage everything.       │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  💬 Want to add more details? (optional chat)       │
│  ┌───────────────────────────────────────────────┐  │
│  │ Also need email confirmations and a           │  │
│  │ 24-hour cancellation policy                   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│            [ ✨ Generate Specification ]             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Step 2: AI-Generated Spec Review (1-5 minutes depending on user)**
```
┌─────────────────────────────────────────────────────┐
│  📋 YOUR APP SPECIFICATION                          │
│  Everything below was generated from your           │
│  description. Edit only what you disagree with.     │
│                                                     │
│  ▸ App Info ──────────────────── ✅ Looks good      │
│    Name: Table Reserve Pro                          │
│    Type: Multi-role Booking System                  │
│                                                     │
│  ▾ Users & Roles ────────────── ✏️ [Edit]          │
│    👤 Customer (Email + Google login)               │
│       • View available tables                       │
│       • Make/cancel reservations                    │
│       • View booking history                        │
│       • View menu                                   │
│    👤 Admin (Email login)                           │
│       • View all bookings (calendar)                │
│       • Confirm/reject bookings                     │
│       • Manage tables & menu                        │
│       • View reports                                │
│                                                     │
│  ▸ Data Model ───────────────── ✅ Looks good       │
│    4 entities: User, Table, Reservation, MenuItem   │
│                                                     │
│  ▸ Business Rules ───────────── ✅ Looks good       │
│    • 24hr cancellation (from your input)            │
│    • No double-booking                              │
│    • Max party size: 8                              │
│    • Operating hours: 10AM-10PM                     │
│                                                     │
│  ▸ Integrations ─────────────── ✅ Looks good       │
│    • Email confirmations ✓ (from your input)        │
│                                                     │
│  ▸ UI Preferences ──────────── ✏️ [Edit]           │
│    • Sidebar layout, Dark+Light mode, Blue          │
│                                                     │
│  💬 "Anything to add or change?"                    │
│  ┌───────────────────────────────────────────────┐  │
│  │ (conversational refinements)                  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│           [ 🚀 Generate Enterprise App ]            │
└─────────────────────────────────────────────────────┘
```

### Three User Paths (All Valid):

| Mode | Steps | Time | Quality |
|------|-------|------|---------|
| **Fast path** (lazy user) | Type description → Generate | 30 seconds | ✅ Good (smart defaults) |
| **Review path** (normal user) | Type → Review → Tweak 2-3 things → Generate | 3-5 min | ✅✅ Great |
| **Expert path** (detailed user) | Type → Review → Edit every section → Chat → Generate | 10-15 min | ✅✅✅ Perfect |

### UX Principles Applied:

| Principle | Implementation |
|-----------|---------------|
| **"Don't ask, suggest"** | AI pre-fills everything. User confirms, not creates. |
| **"Progressive disclosure"** | Sections collapsed by default. Expand only to edit. |
| **"Chat as fallback"** | Chat box at bottom for edge cases without extra form fields. |
| **"Smart defaults"** | AI picks sensible defaults based on app type/domain. |
| **"Fast path"** | Lazy user: type → Generate → done in 30 seconds. |
| **"Expert path"** | Detailed user: expand, tweak, chat, refine → 10-15 minutes. |

### Original 8-Step Wizard (Still Available as "Expert Mode")

The original wizard steps still exist as EXPANDABLE SECTIONS in the review page:

1. **App Type & Name** → "App Info" section
2. **Users & Roles** → "Users & Roles" section  
3. **Features Per Role** → Nested under each role
4. **Data Entities** → "Data Model" section
5. **Business Rules** → "Business Rules" section
6. **Scale & Non-Functional** → "Technical Requirements" section
7. **UI Preferences** → "Design" section
8. **Review & Confirm** → The entire review page IS this step

---

## 6. Remaining Work to Design

### 🔴 Not Yet Designed (Continue in Next Session)

1. **Agent Pipeline Architecture (LAYER 4)**
   - How each agent is prompted
   - What context each agent receives
   - Sequencing and dependencies between agents
   - How agents reference pattern library code
   - Error handling when agent output is invalid

2. **Specification Engine Schema (LAYER 2)**
   - Exact JSON schema for the specification
   - How wizard output maps to spec fields
   - Validation rules for the spec

3. **Pattern Library Inventory (LAYER 3)**
   - Full list of all patterns needed
   - What each pattern contains (files, exports)
   - How patterns are composed together
   - Versioning of patterns

4. **Assembly & Validation Pipeline (LAYER 5)**
   - How agent outputs + patterns merge into a project
   - What validation checks run
   - How conflicts are resolved
   - Final project structure

5. **Modify Mode Architecture**
   - How existing codebases are scanned
   - How the spec is generated from existing code
   - How changes are applied (SEARCH/REPLACE from prompts-v2)

6. **Implementation Plan**
   - What to build first (MVP scope)
   - Technology for the platform itself
   - Timeline and milestones

7. **Product Name & Branding**
   - Working title ideas: AppForge, SpecForge, BuildForge
   - To be finalized

---

## Quick Reference: What This Platform IS and IS NOT

### ✅ IS:
- An enterprise app generator for non-techies
- A guided wizard that collects rich requirements
- A multi-agent pipeline that generates production-ready code
- A pattern library that guarantees enterprise quality
- An internal team tool (SaaS later)
- Built for web apps (mobile later)

### ❌ IS NOT:
- A visual/drag-and-drop builder (like Bubble)
- An IDE or code editor
- An LLM wrapper that forwards prompts
- A teaching/learning tool
- Ruflo or an agent orchestration CLI
- prompts-v2 (but borrows the modify concept)

---

## Key Quotes from the Session

> "I don't care if I invested significant work into prompts-v2. If I need to scrap this project I can do it."

> "These tools have problems with context and output quality. If I say 'I want a restaurant booking app', the output should be enterprise level and production ready with all the database and non-functional requirements ready."

> "But if we ask too many questions the user will be frustrated — how to solve this problem?"
> → Solved with "AI Fills, User Confirms" approach.

> "This project is for my internal team."

> "I need Enterprise quality GUARANTEED and also Scalability and Flexibility."
> → Led to the hybrid Pattern Library + Multi-Agent approach.
