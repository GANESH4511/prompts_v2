---
name: frontend-builder-elite
description: Builds production-grade frontend systems with strong architecture, performance discipline, and UX precision. Use when designing or implementing serious frontend features.
---

# Frontend Builder Skill (Elite)

## Purpose
Build frontend systems that scale in complexity, team size, and usage without degrading UX or maintainability.

## Build process

1. **Define the user problem, not the UI**  
   State the user pain, frequency, and impact. UI is a consequence, not the goal.

2. **Architect before coding**  
   Define page boundaries, data flow direction, and component ownership upfront.  
   No component exists without a clear responsibility.

3. **State minimalism**  
   Store the least possible state.  
   Prefer derived state.  
   Global state is a last resort and must justify its cost.

4. **Data flow discipline**  
   One-directional data flow only.  
   Side effects are isolated.  
   No hidden mutations.

5. **Interaction completeness**  
   Every async action must define loading, success, empty, error, and retry states.  
   Missing states are bugs.

6. **UX precision**  
   Layout shifts, focus loss, jank, and delayed feedback are unacceptable.  
   Measure perceived performance, not just metrics.

7. **Accessibility as a constraint**  
   Keyboard navigation, screen reader support, and focus order are mandatory.  
   If it breaks accessibility, it is broken code.

8. **Performance by design**  
   Prevent unnecessary renders.  
   Split bundles intentionally.  
   Assume low-end devices and slow networks.

9. **Consistency enforcement**  
   Follow design system tokens and patterns strictly.  
   Visual inconsistency signals architectural failure.

## Output expectations

- Components are boring, predictable, and reusable  
- Code reads top-down and explains itself  
- New developers can understand intent without explanation  

## Failure rules

- Do not code before structure is clear  
- Do not optimize prematurely or ignore obvious bottlenecks  
- Do not trade long-term clarity for short-term speed  
- Do not ship UI that confuses or surprises users



# Backend Builder Skill

## Purpose
Designs and builds backend services, APIs, and business logic.

## Build process

1. **Define responsibility**  
   Clearly scope what the service or endpoint owns.

2. **Design the contract first**  
   Specify inputs, outputs, errors, and status codes before coding.

3. **Data modeling**  
   Model real constraints and relationships, not shortcuts.

4. **Business logic enforcement**  
   Validate and enforce rules server-side only.

5. **Error handling**  
   Fail fast, return explicit errors, log with context.

6. **Security baseline**  
   Validate inputs, authenticate early, authorize explicitly.

7. **Scalability awareness**  
   Avoid blocking calls, N+1 queries, and unbounded memory use.

## Failure rules

- Do not put business logic in controllers  
- Do not leak internal errors  
- Do not add abstractions without scale pressure

---
