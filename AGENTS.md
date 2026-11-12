# Arryan HRIS Backend — Development & Architecture Rules

## 1. Master Data Design Invariants
- **No Free-Text for Core Entities**: Core organizational entities (Departments, Job Titles, Office Branches/Geofences, Shift Schedules, Leave Types) MUST be implemented as dedicated database tables with foreign key constraints, NOT free-text strings on transactional or profile models.
- **Master Data Schema Convention**:
  - Each master data model MUST contain `id` (UUID), `code` (unique uppercase string, e.g. `IT`, `FIN`), `name` (string), and standard timestamps (`createdAt`, `updatedAt`).
  - Active/Inactive flag (`isActive: Boolean @default(true)`) should be provided for soft deactivation without breaking historical foreign keys.
- **Referential Integrity**:
  - Foreign key relations from employee profiles to master tables (e.g. `departmentId`, `jobTitleId`) must specify safe `onDelete` actions (typically `Restrict` or `SetNull`).

## 2. Git & Branch Protection Governance
- **No Direct Push to `main`**: All modifications, features, and fixes must be implemented on dedicated feature branches (`feat/*`, `fix/*`, `chore/*`) and submitted via Pull Requests.
- **Quality Gate Prerequisite**: Pull requests require 100% passing status checks on the `Build & Typecheck` CI workflow (Prisma schema validation, client generation, Vitest unit tests, database integration tests, and TypeScript build) before merge.
- **Merge Authority**: Pull requests to `main` are reviewed and merged exclusively by the authorized maintainer account (`rakai77`).

## 3. Authentication & Security Invariants
- **Dual Transport**: Authentication endpoints must preserve dual-transport capability (Bearer `Authorization` header for API/mobile clients and HttpOnly cookies for web browsers).
- **Sensitive Data Filtering**: Never return `passwordHash`, raw token secrets, or activation/refresh token hashes in API responses.

