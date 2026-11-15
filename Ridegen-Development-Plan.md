# Ridegen Development Plan

**Superseded for the current phase.** The user has removed login and database requirements. Use `Ridegen-Upload-Development-Plan.md` and PRD version 1.1 instead. The original plan below is retained as historical context, not active implementation instructions.

Based on `Ridegen-PRD.md`, version 1.0 draft.

## Implementation Status

The original authenticated/database foundation has been replaced by an open, browser-memory upload workflow. Its authentication and database implementation has been removed.

Current work and verification are tracked in the replacement plan and README.

No PostgreSQL provisioning, administrator credentials, or migrations are needed for the current phase.

## 1. Scope and Approach

Build a single-administrator application for generating reproducible synthetic ride datasets, not recording or representing actual completed trips.

The workspace currently contains the PRD only. Implement in dependency order: application foundation, reference data, configuration, scheduling, revenue allocation, reporting, and deployment. Start with explicitly labelled distance estimates; introduce a routing provider only if verified road distances are required.

## 2. Decisions to Resolve Before Generator Development

These details are not specified in the PRD. Resolve and document them before step 5; reference-data and application work can proceed first.

| Decision | Proposed starting point | Why it matters |
| --- | --- | --- |
| Currency and revenue precision | Confirm currency; store money as integer minor units, never floating-point totals. | Ensures reliable reconciliation. |
| Timezone and daily working hours | Use one configurable business timezone and explicit shift start/end times. | Determines month boundaries and scheduling capacity. |
| Fare calculation | Confirm whether fares are sampled within limits or derived from distance/time using a tariff. | Defines what makes fares realistic and revenue targets feasible. |
| Revenue target tolerance | Confirm acceptable difference and whether an exact match is mandatory. | Exact matching may be impossible under configured constraints. |
| Pilot working-day policy | Confirm how to choose 25 versus 26 days and how weekly rest conflicts are handled. | Short months and rest rules can make targets infeasible. |
| Pilot/vehicle assignment | Confirm fixed assignments versus a shared vehicle pool. | Changes resource availability and scheduling logic. |
| Distance source | Begin with administrator-supplied pickup/drop distance estimates, including units and provenance. | Coordinates alone do not provide verified road distances. |
| Dataset size | Define expected pilots, vehicles, rides per batch, and acceptable generation time. | Determines whether generation needs a background worker. |

## 3. Ordered Development Steps

### Step 1: Create the Application Foundation

- Scaffold Next.js with TypeScript, server-side APIs, linting, and environment-variable validation.
- Configure PostgreSQL, a migration workflow, and a database access layer.
- Add single-administrator sign-in, secure sessions, sign-out, and protected pages/API routes. Do not add public registration.
- Create the application shell: Dashboard, Pilots, Vehicles, Locations, Generation Batches, and Reports.
- Add shared form validation, error handling, loading states, and responsive navigation.
- Document Windows local setup and provide an environment-variable template without secrets.

**Complete when:** The administrator can sign in locally, navigate protected pages, and connect to the database; unauthenticated requests are rejected.

### Step 2: Define the Data Model and Batch Lifecycle

- Model administrator access, pilots, vehicles, locations, pairwise distance estimates, generation batches, pilot working-day schedules, and rides.
- Give pilots and vehicles stable identifiers, active/inactive status, and any confirmed availability or assignment fields.
- Store location names, coordinates, stable import keys, and validation status.
- Store batch configuration, month/year, timezone, seed, generator version, input snapshots, distance provenance, totals, warnings, and failure details.
- Define batch states such as pending, running, completed, and failed. Keep incomplete output out of successful reports.
- Store ride start/end timestamps, pilot/vehicle references, pickup/drop references, distance, distance source, speed, duration, fare, batch ID, and an explicit synthetic-data marker.
- Add constraints and indexes for stable identifiers, valid values, and batch/report lookups.

**Complete when:** Migrations create the schema, invalid records are rejected, and saved batches retain the inputs needed to reproduce a run after reference data changes.

### Step 3: Build Pilot and Vehicle Management

- Add list, create, edit, and deactivate flows for pilots and vehicles.
- Support CSV/Excel upload for both record types, with downloadable templates and import previews.
- Validate required identifiers, duplicate records, active status, and confirmed assignment rules.
- Show row-level errors before committing imports; require an explicit choice for updates versus replacements.
- Preserve historical batch snapshots when records change or become inactive.

**Complete when:** The administrator can manage records manually or through validated uploads without corrupting historical datasets.

### Step 4: Build Locations and Distance Management

- Add location list, create, edit, and deactivate flows, with development sample locations.
- Support CSV/Excel imports with templates, preview, and row-level validation.
- Validate names, numeric latitude/longitude ranges, missing values, duplicate keys, and likely duplicate coordinates/names.
- Make update and replace behavior explicit; show affected records and require confirmation before replacement.
- Add a way to manage pickup/drop distance estimates and their source. Treat direction separately unless symmetry is explicitly configured.
- Allow setup without an upload, but block generation unless valid locations and usable pickup/drop distance pairs exist.
- If a routing service is added, retain provider/source information and handle failures without silently substituting straight-line distance as road distance.

**Complete when:** Valid locations and usable distance pairs are available, and invalid/duplicate imports produce actionable feedback.

### Step 5: Build Generation Configuration and Preflight Validation

- Add dashboard inputs for calendar month/year, revenue target, fare minimum/maximum, eligible pilots/vehicles, and random seed.
- Expose the agreed shift, working-day, rest, assignment, speed, and distance settings as appropriate.
- Validate values on the server as well as in the interface, including positive targets, ordered fare limits, and calendar rules.
- Check eligible resource availability, usable routes, positive distances, and pilot working-day feasibility.
- Estimate revenue capacity using the same constraints as the generator. Distinguish proven impossibility from an approximate capacity warning.
- Separate blocking errors from warnings; do not silently relax rest, fare, speed, gap, or availability rules.

**Complete when:** Invalid configurations cannot start a batch, and the administrator can understand and resolve preflight warnings.

### Step 6: Implement Deterministic Scheduling and Ride Generation

- Implement the generator as a testable server-side domain module, separate from UI and database access.
- Use seeded randomness, deterministic input ordering, and an explicit generator version.
- Generate each pilot's randomized working-day calendar using the agreed 25/26-day and rest policy; report conflicts rather than hiding them.
- Schedule rides within working shifts and the selected calendar month in the configured timezone.
- Select plausible, distinct pickup/drop pairs with known distance provenance.
- Select speed within 10–80 km/h and derive duration consistently from distance and speed, with a documented rounding policy.
- Prevent overlaps for both pilots and vehicles; enforce at least five minutes between successive rides for each resource.
- Generate fares within confirmed boundaries and tariff rules, with no waiting or night surcharge.
- Bound generation attempts and stop with an actionable outcome when capacity is exhausted.
- Save output atomically, or use isolated staging that is published only after successful validation. Prevent duplicate batch execution.

**Complete when:** The same configuration, seed, input snapshot, and generator version reproduce the same ride records, with no resource conflicts or scheduling violations.

### Step 7: Add Revenue Allocation and Independent Validation

- Allocate target revenue across eligible pilots and working days while varying ride counts, fares, and daily totals.
- Integrate allocation with available scheduling capacity rather than adding rides beyond working hours.
- Reconcile target revenue, generated revenue, and signed/absolute differences using integer minor units.
- Implement bounded adjustment of fares or ride counts while preserving all constraints and the agreed tolerance.
- Distinguish infeasible targets from cases where the bounded algorithm could not find a solution; never report an unsupported exact-match guarantee.
- Independently validate finished output: calendars, resource overlaps, gaps, speeds, distance/duration consistency, fare limits, required labels, and revenue totals.
- Publish only validated batches; retain failure explanations and make any intentionally retained partial result unmistakably incomplete.

**Complete when:** Totals reconcile exactly to stored rides, valid targets meet the agreed tolerance, and unsuccessful runs explain the limitation without bypassing constraints.

### Step 8: Build Preview, Reporting, and Exports

- Add batch history, saved configuration, status, warnings, and paginated ride previews.
- Build ride-level detail, pilot daily/monthly summaries, vehicle summaries, and revenue reconciliation.
- Generate CSV reports and a multi-sheet Excel workbook from the same saved batch, not by rerunning generation.
- Include synthetic-data labels and batch identifiers in every report/export, with configuration, timezone, seed, and distance-source metadata where relevant.
- Protect exports against spreadsheet formula injection and enforce administrator authorization.
- Ensure all summary totals match ride-level records, including after filtering where applicable.

**Complete when:** Downloaded reports open correctly, agree with previews and stored totals, and cannot reasonably be mistaken for actual completed-trip records.

### Step 9: Test End to End with Sample Data

- Add unit tests for seeded generation, calendar allocation, fare/revenue arithmetic, duration calculations, and scheduling.
- Add invariant/property tests across many seeds for pilot/vehicle overlaps, minimum gaps, shift/month boundaries, fare limits, and speed limits.
- Add import/API/database integration tests for malformed files, duplicates, update/replace behavior, failed batches, and unauthorized access.
- Test February in leap and non-leap years, 30/31-day months, weekly-rest conflicts, insufficient vehicles, missing distances, tiny targets, and excessive targets.
- Add end-to-end tests covering sign-in, uploads, configuration, generation, warnings, previews, and downloads.
- Verify reproducibility after reference-data edits and verify CSV/Excel totals against stored rides.
- Measure generation and export performance at the agreed dataset size; add a durable background worker if synchronous execution is insufficient.

**Complete when:** Automated checks pass, representative sample batches satisfy every PRD acceptance criterion, and observed performance meets the agreed limits.

### Step 10: Prepare and Verify Production Deployment

- Select hosting compatible with Next.js, PostgreSQL, and any required background jobs.
- Configure production secrets, HTTPS, secure cookies, upload limits, and dependency/security checks.
- Set up migrations, administrator provisioning, database backups, restore verification, and deployment rollback procedures.
- Add structured logs and generation-failure monitoring without logging secrets or unnecessary personal data.
- Deploy to staging first and repeat the complete import-to-export workflow.
- Publish administrator instructions for imports, distance estimates, seeds, warnings, reconciliation, and synthetic-data restrictions.

**Complete when:** A staging smoke test passes, backup/restore is verified, and production can be deployed and operated safely.

## 4. Delivery Checkpoints

| Checkpoint | Steps | Demonstrable outcome |
| --- | --- | --- |
| Foundation | 1–2 | Protected application and versioned database schema. |
| Reference data | 3–4 | Usable pilots, vehicles, locations, and distance estimates. |
| Generator MVP | 5–6 | Reproducible, conflict-free rides for a configured month. |
| Revenue-ready | 7 | Validated allocation and transparent target reconciliation. |
| Reporting-ready | 8 | Consistent previews, summaries, CSV, and Excel exports. |
| Release-ready | 9–10 | Tested application, staging verification, and operational documentation. |

## 5. Release Acceptance Checklist

- [ ] All pages, mutation APIs, and downloads require administrator access.
- [ ] Invalid imports and generation configurations are rejected with clear errors.
- [ ] Generation requires valid locations and usable distance data.
- [ ] Working-day/rest conflicts are visible and handled according to an explicit policy.
- [ ] No pilot or vehicle has overlapping rides or a gap shorter than five minutes.
- [ ] Rides respect shifts, selected month boundaries, speed limits, fare rules, and distance/duration consistency.
- [ ] Target, generated revenue, and difference reconcile to saved ride records.
- [ ] Infeasible or unsuccessful runs are not presented as successful completed datasets.
- [ ] Identical saved inputs, seed, and generator version reproduce identical ride records.
- [ ] Every report/export clearly identifies synthetic data and its generation batch.
- [ ] Automated tests, representative sample runs, and staging smoke tests pass.

## 6. Deferred Unless Separately Requested

Multi-user roles, public signup, live dispatch, GPS tracking, payments, customer booking, actual-trip accounting, and claims of verified road distances without a routing source are outside this initial scope.
