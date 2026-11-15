# EVZIP Synthetic Rides Generator
**Product Requirements Document | Version 2.0 - Dated Idle-Window Generation**

## 1. Objective and Interface

Provide one open page for CSV uploads, criteria, generation, preview, warnings, and downloads. No login, database, sidebar, manual reference entry, or persistent browser storage. Reference files remain in browser memory; generation uses a stateless local server and saves nothing.

All generated rides are explicitly synthetic and must never be represented as actual completed trips.

## 2. Required Inputs

- Inclusive From/To **idle start dates**.
- CSV pickup/drop routes with positive distance in kilometres and optional distance provenance.
- CSV driver names, with optional stable driver IDs.
- CSV user IDs, names, and registration dates/timestamps.
- CSV vehicle idle dates, vehicle numbers, makes, and idle times (separate start/end or combined timings).
- Target revenue and a checkbox indicating net versus gross (unchecked means gross).
- Average price per kilometre in INR.
- Minimum user fare and maximum fare, both whole positive rupee amounts.
- Optional existing-rides CSV, plus an option to use only its known vehicles/drivers and bounded gaps between existing rides.

All primary inputs are mandatory. Existing rides are the sole optional upload. Templates, row validation, previews, and explicit dataset-replacement confirmation are required. Each CSV is limited to 5 MB / 10,000 records; combined generation input is limited to 8 MB.

## 3. Fixed Server Rules

- INR currency, Asia/Kolkata timezone, 5% GST, and speeds between 10 and 80 km/h.
- 26 working days per pilot/calendar month as a target and cap, with one full day off each Monday-Sunday week. Limited dates/rest conflicts must produce warnings rather than fabricated availability.
- Shift inputs are removed. Only uploaded vehicle idle windows authorize synthetic work.
- A `20:00-05:00` window ends the following morning. Two date rows authorize two separate overnight windows. The selected period filters window start dates, so final-night rides can finish on the next date.
- Vehicle turnaround minimums vary from 4:01 to 4:59 in seconds; no fixed round-minute gap field. Longer waits may be needed to respect resource availability.
- Randomization is handled internally; no seed field is shown. Internal metadata supports reproducibility.
- Request times are randomized across available windows with nonuniform second-level timings, not aligned to a repeated timestamp grid.

## 4. Identity, Availability, and Timing

- Assign only drivers/users from their uploads and vehicles from eligible dated idle windows.
- Entire request-to-completion intervals must fit the uploaded idle window.
- Prevent overlaps for each vehicle, driver, and user, including known uploaded existing rides.
- User requests must occur strictly after registration. Date-only registration means midnight IST.
- Never assign synthetic driving during a pilot's weekly day off; account for existing work when choosing rest days.
- Route distance and randomly sampled 10-80 km/h speed determine travel duration consistently. Dispatch delay is separate from travel time.
- Uploaded distance estimates must remain labelled estimates, not independently verified road distances. No external routing/repositioning assumptions are implied.

## 5. Fare and Revenue

- User fares are whole rupees with no decimal fare amounts, never below the configured minimum, including trips shorter than 2 km.
- Fare follows supplied distance x average price/km, rounded to the nearest whole rupee and raised to the minimum when necessary. Exclude routes above the maximum; do not alter supplied distances or choose unrelated prices.
- Random route selection provides variation. A distinct fare appears at most three times per synthetic batch. Warn about infeasible/unfinished revenue rather than relaxing this cap.
- No waiting/night surcharges.
- Net target: calculate gross equivalent using net x 1.05. Gross target: calculate net equivalent using gross / 1.05.
- Split each whole-rupee gross fare into net and GST in integer paise; reconcile summed net + GST to gross.
- Display target basis, target/equivalent totals, generated net/gross/GST, signed difference, and warnings.
- Whole-rupee target tolerance is INR 1. Mark nonmatching/bounded runs partial and never imply they prove mathematical infeasibility.

## 6. Existing-Rides Mode

Uploaded existing rides always block conflicts. When the restriction option is checked, require existing data, intersect its vehicles/drivers with reference uploads, and generate only within gaps bounded by consecutive existing vehicle rides and uploaded idle windows. Do not use resources absent from the existing data or add rides outside those bounded gaps. Existing vehicle rides receive conservative five-minute buffers.

## 7. Output and Architecture

- Unique ride IDs and batch IDs, explicit `synthetic=true` and `data_type=SYNTHETIC` on every generated row.
- Same-page preview, CSV export, and audit JSON. Partial output is explicitly marked partial in the interface, filename, and rows.
- Next.js/TypeScript UI and stateless server-side generation API; no database or authentication.
- Preserve internal rule version, randomization value, input hash, driver calendars, and generation criteria in audit metadata.
- Bound scheduling to 5000 rides and 60,000 attempts; independently validate output before returning it.
- Local serving on loopback. Review privacy/access and distributed limits separately before public hosting.

## 8. Acceptance

Reject invalid/old-format inputs; respect dated overnight windows, one weekly rest day, 26-day monthly cap, registration dates, existing bookings, fare bounds, distance pricing, GST arithmetic, and the three-use fare cap. Reconcile every exported total and clearly identify all output as synthetic. Refresh clears all session input/output; nothing is saved automatically.
