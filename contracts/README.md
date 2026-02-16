# /contracts — API Contract Registry

This directory is the **single source of truth** for all inter-component API contracts in the Cruzonic Fleet Management Platform.

Every interface between the mobile app, backend API, fleet portal, and shared library is versioned and locked here. No consumer may ship code that violates the current locked contract without following the process below.

---

## Directory Structure

```
contracts/
  README.md           ← This file: governance, process, and policy
  v1/
    openapi.yaml      ← Full OpenAPI 3.1 specification (REST endpoints)
    sync-protocol.md  ← Offline event sync and conflict resolution protocol
    CHANGELOG.md      ← History of all changes within the v1.x line
```

Each major version (v2, v3, …) gets its own directory. Minor versions and patches are tracked inside the version directory's `CHANGELOG.md`.

---

## Versioning Scheme

Contracts follow **Semantic Versioning (SemVer)**:

| Version bump | When to use | Examples |
|---|---|---|
| **Patch** (1.0.x) | Clarifications, typo fixes, additional `description` text — no schema changes | Fixing a typo in a field description |
| **Minor** (1.x.0) | Backward-compatible additions: new optional fields, new endpoints, new enum values | Adding an optional `coDriverId` to an existing request body |
| **Major** (x.0.0) | Breaking changes: removing fields, changing types, renaming endpoints, changing required fields | Removing `annotationText`, changing `eventDate` format from MMDDYY to ISO 8601 |

### Current locked version: **v1.0.0**

---

## Change Process

All contract changes, regardless of size, must go through this process:

### Step 1 — Proposal (RFC)
Open a GitHub issue with the label `contract-change` and prefix the title with `[RFC]`. Describe:
- Which consumers are affected
- Whether it is a breaking change
- Proposed new schema

### Step 2 — Review
- At least **two engineers** from different components (mobile, backend, portal) must approve the RFC.
- For breaking changes, the product owner must also approve.

### Step 3 — Update the contract files
- Edit `contracts/v{N}/openapi.yaml` and/or `sync-protocol.md`.
- Add a `CHANGELOG.md` entry with the date, version bump, and PR link.
- Update the `info.version` field in `openapi.yaml`.

### Step 4 — Update consumers
The PR that merges the contract change **must** include:
- Backend implementation (or a tracked issue with a deadline)
- Updated shared TypeScript types in `/shared/src/`
- Updated mobile app handling
- Updated portal handling

### Step 5 — Deprecation (for breaking changes only)
Before shipping a Major version:
1. Mark deprecated fields/endpoints with `deprecated: true` in the OpenAPI spec.
2. Notify all consumers with a minimum **12-week** deprecation window.
3. The old version directory is kept (read-only) for reference until the deprecation period ends.

---

## Consumer Responsibilities

Each consuming component must:

1. **Pin to a specific contract version** using the `X-Contract-Version: 1.0.0` request header.
2. **Treat unknown fields as ignorable** — consumers must not error on extra fields in responses (forward-compatibility).
3. **Never add undocumented fields** to requests — the server may reject them.
4. **Run contract tests** in CI using the OpenAPI spec (Prism, Dredd, or equivalent).

---

## Contract Test Command

```bash
# Start a mock server from the OpenAPI spec
npx @stoplight/prism-cli mock contracts/v1/openapi.yaml

# Validate backend responses against the spec
npx @stoplight/prism-cli proxy contracts/v1/openapi.yaml http://localhost:3000

# Lint the spec for correctness
npx @redocly/cli lint contracts/v1/openapi.yaml
```

---

## Component Owners

| Component | Contract owner | Review required for changes |
|---|---|---|
| Backend API | Backend team | Required for all changes |
| Mobile app | Mobile team | Required for event ingestion + sync protocol |
| Fleet portal | Portal team | Required for query endpoints |
| Shared types | Any | Required for all changes |
