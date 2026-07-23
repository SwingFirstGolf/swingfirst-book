# SwingFirst — Project Reference

> **Purpose:** Start every new session by reading this file. It captures all architecture, credentials, decisions, and in-progress work as of July 2026.

---

## 1. What SwingFirst Is

A multi-course golf tee sheet management platform for ~6 Arizona golf courses. It syncs booking data from Quick18 (Sagacity Golf — the courses' booking system) into Supabase, then displays it in two UIs:

- **Operator Tee Sheet** — staff-facing, full-featured
- **Live Tee Sheet** — public/booker-facing simplified view

---

## 2. Infrastructure

### GitHub
- **Org/Username:** SwingFirstGolf
- **Repo:** `SwingFirstGolf/swingfirst-book`
- **URL:** https://github.com/SwingFirstGolf/swingfirst-book
- **GitHub account email:** dave@swingfirst.co

### Netlify
- **Token:** `nfc_EMg9ktmtgUuBVsG2D3fvkebXhjM1e74568b7`
- **Deploy script:** `deploy.js` in repo root
- Deploys HTML files from repo to Netlify CDN

### Supabase
- **Project ID:** `ojgxfeaesnaohskxdvam`
- **Project URL:** `https://ojgxfeaesnaohskxdvam.supabase.co`
- **Anon key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qZ3hmZWFlc25hb2hza3hkdmFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2Mjk4MzQsImV4cCI6MjA5MjIwNTgzNH0.zYOq7MUb1ro9vCwLyz-QUhjnWDX9DDLWGqVn4_ONa_U`
- **MCP tool project_id:** `ojgxfeaesnaohskxdvam`
- Supabase MCP is connected — use `mcp__a95237f6-de89-4f49-a409-c813b862c1d7__*` tools

### Quick18 (Sagacity Golf)
- **Admin URL:** https://admin.quick18.com
- **Login (all facilities):** dave@swingfirst.co / swingfirst
- Set as env vars `Q18_USERNAME` / `Q18_PASSWORD` on the Edge Function

---

## 3. Deployed URLs

| URL | Source File | Description |
|-----|-------------|-------------|
| `operator.swingfirst.ai` | `swingfirst-tee-sheet.html` | Operator tee sheet (multi-facility) |
| `book.swingfirst.ai/swingfirst-live.html` | `swingfirst-live.html` | Live tee sheet (Palmbrook, public-facing) |
| `book.swingfirst.ai/swingfirst-bookings.html` | `swingfirst-bookings.html` | Booking management |
| `book.swingfirst.ai/checkin.html` | `checkin.html` | Check-in |

---

## 4. Key Source Files

| File | Purpose |
|------|---------|
| `sync-tee-sheet-edge.ts` | Supabase Edge Function — scrapes Quick18 → stores in Supabase |
| `swingfirst-tee-sheet.html` | Operator UI (2750 lines, vanilla JS SPA, reads Supabase) |
| `swingfirst-live.html` | Booker/live tee sheet (Palmbrook-specific) |
| `deploy.js` | Netlify deploy script |
| `deploy-edge-functions.js` | Supabase Edge Function deploy script |

---

## 5. Quick18 Facility & Course IDs

All facilities use the same login. "Course/default" is accepted by Quick18 as a valid URL path for the primary 18-hole course at 3-course facilities.

| Facility | Q18 Facility ID | 18-hole Course ID | 9-hole Course ID |
|----------|-----------------|-------------------|------------------|
| Palmbrook | 917 | 1614 | 1669 |
| Coyote Lakes | 136 | 1046 | 1047 |
| Union Hills | 962 | `default` | 1671 |
| San Tan Highlands | 1384 | `default` | 18503 |
| Scottsdale CC | 1030 | `default` | 18510 (= "Scottsdale CC Back 9") |
| Six Shooter | 1030 | *(skip for now)* | — |

> **Note:** "Course/default" literally works in Quick18 URLs for all three 18-hole courses. The sync function uses this string directly.

---

## 6. Supabase Courses Table

All entries in the `courses` table. Back-9 entries have slug ending in `-back-9` and are accessed via the "9 Holes" tab in the operator UI (not the sidebar).

| Course Name | Slug | Supabase UUID | Holes |
|-------------|------|---------------|-------|
| Palmbrook Golf Club | `palmbrook` | `29e81e43-7b49-4b58-8b61-ee7271389c74` | 18 |
| Palmbrook Back 9 | `palmbrook-back-9` | `9b97051a-1535-4bb4-96c9-4c0a894724b8` | 9 |
| Coyote Lakes Golf Club | `coyote-lakes` | `097952a0-e291-4498-8012-469da1cfa890` | 18 |
| Coyote Lakes Back 9 | `coyote-lakes-back-9` | `8ec6d400-47b7-4b1a-88c9-a33651ca55a6` | 9 |
| Union Hills Golf Club | `union-hills` | `ffa7f44f-9388-4ec7-b1ca-01319dc9857c` | 18 |
| Union Hills Back 9 | `union-hills-back-9` | `2b85c2fd-c487-4fe0-ac00-fa6381038a7a` | 9 |
| San Tan Highlands | `san-tan-highlands` | `c7bcbc26-d1a8-493d-835d-60ce437d80db` | 18 |
| San Tan Highlands Back 9 | `san-tan-highlands-back-9` | `120fcf66-1613-44bc-bd27-2961dc9113c1` | 9 |
| Scottsdale Country Club | `scottsdale-cc` | `f43be1a2-c2bb-45cd-aa68-118349acb172` | 18 |
| Scottsdale CC Back 9 | `scottsdale-cc-back-9` | **NEEDS TO BE ADDED** | 9 |
| Six Shooter | `six-shooter` | `5734b89d-4771-4ca7-a39b-4c432bdf08af` | 10 |
| Briarwood Country Club | `briarwood-cc` | `ba607049-1b66-49fc-a2ac-36fd6f0f8b28` | 18 |

---

## 7. Sync Edge Function (`sync-tee-sheet`)

- **Deployed:** Yes (version 4, ACTIVE as of July 2026)
- **Schedule:** pg_cron, every 30 minutes
- **What it does:**
  1. Logs into Quick18 via HTTP (CSRF-aware form POST)
  2. Fetches tee sheet HTML for today + tomorrow for each facility
  3. Parses tee times, player names, prices, check-in status, open slots
  4. Fetches booking details page for each reservation → extracts DIA + group name
  5. For group (GRP) bookings: replaces first-name-only player cells with the group's last name (e.g. "GRP: Donald" → "SCARFF")
  6. Upserts into Supabase via `sync_quick18_tee_sheet` RPC

- **Currently syncing:** Palmbrook only (Facility 917, courses 1614 + 1669)
- **Pending:** Extend to all 4 remaining facilities (see §9)

### Player Name Parsing Notes
- Normal booking: `"Tim Boling Summer $46"` → name=`"Tim Boling"`, rate=`"Summer"`, price=`$46`
- GRP lead cell: `"GRP(8):"` → treated as group placeholder
- GRP member cell: `"GRP: Donald"` → replaced with group name from booking details page (e.g. `"SCARFF"`)
- Group name extraction: regex matches `Reservation Group Name` label in booking details HTML; strips ` - Resend`, ` - Copy`, etc. suffixes

---

## 8. Operator Tee Sheet (`swingfirst-tee-sheet.html`)

- **Architecture:** Vanilla JS SPA, ~2750 lines, single file
- **Routing:** No URL routing yet — course stored in `localStorage('sf_op_course')`. `switchCourse()` toggles with zero latency.
- **Planned:** Add `history.pushState` to `switchCourse()` for per-course URLs (e.g. `/palmbrook-18`). Requires catch-all redirect rule on Netlify host. Zero-latency toggle is preserved.
- **Course list:** Read dynamically from Supabase `courses` table. `COURSES` array in JS is for display order and color config only.
- **9-hole tab:** Looks for a course with slug `{current-slug}-back-9`. If found, switches to it; tab label shows "9 Holes".
- **Color config:** Each facility has a distinct accent color defined in `COURSE_COLORS` object.

---

## 9. In-Progress / Next Tasks

### Immediate
1. **Add Scottsdale CC Back 9 to Supabase** — insert row into `courses` table with slug `scottsdale-cc-back-9`, holes=9
2. **Extend sync to all 4 facilities** — update `sync-tee-sheet-edge.ts`:
   - Restructure `COURSES` into `FACILITIES` array with per-facility `facilityId` and `courses[]`
   - Handle `courseId = 'default'` (string, not number) in URL construction
   - Cover: Coyote Lakes, Union Hills, San Tan Highlands, Scottsdale CC (18h + 9h each)
   - Skip Six Shooter
3. **Deploy updated Edge Function** to Supabase

### Soon
4. **Per-course URLs** for `operator.swingfirst.ai` — one-line `history.pushState` addition to `switchCourse()` + Netlify redirect rule
5. **SCC start time** — tee times show starting 6:00 AM but should start ~5:15 AM. Likely a Quick18 or course-settings config issue.

### Deferred
6. Briarwood CC — appears in DB and operator UI sidebar but no Q18 sync configured yet. Dave hasn't mentioned it.
7. Six Shooter — in DB, in sidebar, skip Q18 sync for now.

---

## 10. Key Design Decisions (Don't Re-Litigate)

- **Timezone:** Always UTC-7 (Arizona, no DST). The Edge Function and all date math uses this.
- **GRP bookings:** Show group last name (from booking details page), not individual first names. Quick18 only stores first names for group members — full names aren't accessible via tee sheet scraping.
- **9-hole as separate course:** Treated as a sibling course (`-back-9` slug), not a flag on the 18-hole course. This keeps data clean and UI simple.
- **Single sync function:** All facilities in one Edge Function, not per-facility functions. Runs every 30 min.
- **Zero-dependency HTML parsing:** The sync scrapes Quick18 HTML using regex/string matching (no DOM/cheerio). Works in Deno Edge Function.

---

## 11. How to Start Fresh in a New Session

1. Read this file first
2. The Supabase MCP is connected — use it directly for DB queries
3. Key files to read before modifying: `sync-tee-sheet-edge.ts`, `swingfirst-tee-sheet.html`
4. Deploy Edge Function changes via Supabase MCP `deploy_edge_function`
5. Deploy HTML changes via `deploy.js` or direct Netlify API call
6. Test tee sheet at https://operator.swingfirst.ai and https://book.swingfirst.ai/swingfirst-live.html
