# RuVector Integration Brainstorm

**Date:** 2026-03-25
**Status:** In Progress (Understanding Phase)
**Skill Used:** brainstorming

---

## 1. Current Project Context

### Stack
- **Backend:** Node.js + Express + Prisma (SQLite)
- **Frontend:** Next.js (App Router, TypeScript)
- **LLM:** Custom `generatePrompt` / `generatePromptStream` in `backend/src/llm/`

### Current Database Schema (Prisma/SQLite)
```
User → Project → Page → Section → Prompt
                   ↓
            ImplementHistory
            ChangeRequest
```

### Key Files
- `backend/src/lib/prisma.js` — Prisma client
- `backend/src/routes/implement.js` — 2-pass LLM pipeline
- `backend/src/lib/contextBuilder.js` — NLP/Developer context modes
- `backend/src/lib/fileOps.js` — SEARCH/REPLACE parsing

### Core Feature
2-pass LLM pipeline for implementing code changes:
- **Pass 1:** Plan generation (NLP context)
- **Pass 2:** SEARCH/REPLACE patches (Developer context)

---

## 2. Decision Log

### Decision 1: Primary Motivations for RuVector
**What:** Replace SQLite/Prisma with RuVector
**Options Considered:**
1. Semantic Search
2. Self-Learning ✅
3. Graph Relationships ✅
4. Performance at Scale ✅
5. Other

**Chosen:** Options 2, 3, 4
**Reasoning:** User wants system that learns from usage, models complex relationships, and scales efficiently.

---

### Decision 2: Self-Learning Behaviors
**What:** What should the system learn from?
**Options Considered:**
1. User feedback patterns (accept/reject/modify) ✅
2. Implementation success rates (no errors, no reverts) ✅
3. Usage frequency & sequences (prompts used together) ✅
4. Query patterns (search behavior)

**Chosen:** Options 1, 2, 3
**Reasoning:**
- Implementation success is highest-value signal (already have `ImplementHistory`)
- User feedback directly trains quality ranking
- Usage sequences enable smart suggestions
- Query patterns less critical (users navigate by Page/Section)

---

### Decision 3: Graph Relationships to Model
**What:** Which entity connections matter most?
**Options Considered:**
1. Prompt → Section → Page hierarchy
2. Prompt similarity (embeddings) ✅
3. Implementation lineage (change tracking) ✅
4. User behavior graphs (collaboration) ✅
5. Cross-project relationships (reusability) ✅

**Chosen:** Options 2, 3, 4, 5
**Reasoning:** User wants full graph power for similarity search, lineage tracking, collaboration patterns, and template reuse across projects.

---

### Decision 4: Scale Expectations
**What:** Target scale for the system
**Options Considered:**
1. Small (<10 projects, <1K prompts, 1-5 users) ✅
2. Medium (10-100 projects, 10K-100K prompts, 10-50 users)
3. Large (100+ projects, 1M+ prompts, 100+ users)
4. Enterprise (multi-tenant SaaS)

**Chosen:** Option 1 (Small) — current state
**Reasoning:** Start small, design for growth without over-engineering.

---

### Decision 5: Deployment Environment
**What:** Where will this run?
**Options Considered:**
1. Local development only ✅
2. Single server
3. Containerized (Docker)
4. Cloud-native (Kubernetes)

**Chosen:** Option 1 — Local development for now
**Reasoning:** Keep it simple, can scale deployment later.

---

## 3. RuVector Features to Use

Based on decisions above, these RuVector features are relevant:

### Core
- **ruvector-core** — Vector DB with HNSW indexing
- **ruvector-graph** — Cypher queries, hyperedges for relationships

### Self-Learning
- **SONA** (Self-Optimizing Neural Architecture) — LoRA + EWC++ for learning
- **ReasoningBank** — Trajectory learning with verdict judgment
- **GNN layers** — Graph neural networks for similarity

### Graph
- **Cypher queries** — Neo4j-style graph traversals
- **Hyperedges** — Connect 3+ nodes (prompt → implementation → user)

### Embeddings
- Local ONNX embeddings (no API costs)
- Semantic similarity for prompt matching

---

## 4. Open Questions (To Resolve)

1. **Embedding Model:** Which model for prompt embeddings?
   - all-MiniLM-L6-v2 (384-dim, fast)
   - BGE-small (384-dim, better retrieval)
   - Something larger?

2. **Migration Strategy:** How to migrate existing SQLite data?
   - Big bang migration?
   - Gradual dual-write?
   - Fresh start (acceptable for small scale)?

3. **Hybrid Approach:** Keep some data in SQLite?
   - User auth in SQLite (simpler)
   - Prompts/vectors in RuVector?

4. **Node.js Integration:** Use which RuVector package?
   - `@ruvector/node` — Native NAPI bindings
   - `@ruvector/core` — JavaScript with WASM fallback

---

## 5. Assumptions (To Validate)

1. **Local-first is acceptable** — No cloud deployment needed initially
2. **Eventual consistency OK** — Learning signals can be async
3. **No real-time collaboration** — Single user editing at a time
4. **English prompts only** — No multi-language embedding needs
5. **File-based persistence OK** — RuVector can persist to disk like SQLite

---

## 6. Non-Functional Requirements (To Confirm)

| Requirement | Proposed Default | Status |
|-------------|-----------------|--------|
| Query latency | <100ms for search | Pending |
| Learning latency | Async, <1s background | Pending |
| Storage | Local filesystem | Confirmed |
| Backup/Restore | Manual export/import | Pending |
| Security | Local only, no auth needed | Pending |

---

## 7. Next Steps in Brainstorming

1. ✅ Understand motivations
2. ✅ Understand self-learning scope
3. ✅ Understand graph relationships
4. ✅ Understand scale
5. ✅ Understand deployment
6. ✅ Confirm non-functional requirements
7. ✅ Explore design approaches (2-3 options)
8. ⏳ Present recommended architecture
9. ⏳ Document final design
10. ⏳ Implementation handoff

---

### Decision 6: Architecture Approach
**What:** How to integrate RuVector with existing system
**Options Considered:**
1. Hybrid (SQLite auth + RuVector prompts) ✅
2. Full RuVector replacement
3. RuVector as intelligence layer only

**Chosen:** Option 1 — Hybrid Architecture
**Reasoning:**
- Minimal migration risk (auth unchanged)
- Best of both worlds (relational + vector/graph)
- Can migrate incrementally
- Full graph power for prompts
- Full self-learning capability

---

## 8. Reference: RuVector Capabilities

### npm Packages (Node.js)
```bash
npm install ruvector                    # All-in-one
npm install @ruvector/core              # Core vector DB
npm install @ruvector/node              # Native bindings
npm install @ruvector/gnn               # GNN layers
npm install @ruvector/graph-node        # Graph + Cypher
npm install @ruvector/sona              # Self-learning
```

### Key APIs
```javascript
// Vector search
const db = new VectorDB(384);
db.insert('prompt1', embedding, { type: 'nlp' });
const results = db.search(queryEmbedding, 10);

// Graph queries (Cypher)
db.query(`
  MATCH (p:Prompt)-[:USED_IN]->(i:Implementation)
  WHERE i.success = true
  RETURN p, count(i) as successCount
  ORDER BY successCount DESC
`);

// Self-learning (SONA)
const sona = new SonaEngine({ hidden_dim: 256 });
sona.record_trajectory(promptEmbed, 'accepted');
sona.learn();
```

### Performance (from RuVector docs)
- Query latency: <1ms (HNSW)
- Learning latency: <100μs (MicroLoRA)
- Memory: ~200MB for 1M vectors
- SIMD acceleration: AVX-512, NEON

---

## 9. Relevant RuVector Examples

- `examples/nodejs/` — Node.js integration patterns
- `examples/graph/` — Graph + Cypher queries
- `examples/ruvLLM/` — LLM + vector search (relevant to implement feature)

---

*This memory file can be loaded by any AI assistant to continue the brainstorming session.*
