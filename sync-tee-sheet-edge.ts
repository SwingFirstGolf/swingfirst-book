// Supabase Edge Function: Quick18 → SwingFirst Supabase sync
// Deployed to: supabase functions/sync-tee-sheet
// Scheduled via pg_cron every 30 minutes
// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const Q18_BASE = 'https://admin.quick18.com';
const SB_URL   = 'https://ojgxfeaesnaohskxdvam.supabase.co';
const SB_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qZ3hmZWFlc25hb2hza3hkdmFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2Mjk4MzQsImV4cCI6MjA5MjIwNTgzNH0.zYOq7MUb1ro9vCwLyz-QUhjnWDX9DDLWGqVn4_ONa_U';
const UA       = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// ─── Facility & Course Config ─────────────────────────────────────────────

interface CourseConfig {
  q18Id: number | 'default';
  sbId:  string;
  name:  string;
}

interface FacilityConfig {
  facilityId: number;
  courses:    CourseConfig[];
}

const FACILITIES: FacilityConfig[] = [
  {
    facilityId: 917,
    courses: [
      { q18Id: 1614, sbId: '29e81e43-7b49-4b58-8b61-ee7271389c74', name: 'Palmbrook 18h' },
      { q18Id: 1669, sbId: '9b97051a-1535-4bb4-96c9-4c0a894724b8', name: 'Palmbrook 9h'  },
    ],
  },
  {
    facilityId: 136,
    courses: [
      { q18Id: 1046, sbId: '097952a0-e291-4498-8012-469da1cfa890', name: 'Coyote Lakes 18h' },
      { q18Id: 1047, sbId: '8ec6d400-47b7-4b1a-88c9-a33651ca55a6', name: 'Coyote Lakes 9h'  },
    ],
  },
  {
    facilityId: 962,
    courses: [
      { q18Id: 'default', sbId: 'ffa7f44f-9388-4ec7-b1ca-01319dc9857c', name: 'Union Hills 18h' },
      { q18Id: 1671,      sbId: '2b85c2fd-c487-4fe0-ac00-fa6381038a7a', name: 'Union Hills 9h'  },
    ],
  },
  {
    facilityId: 1384,
    courses: [
      { q18Id: 'default', sbId: 'c7bcbc26-d1a8-493d-835d-60ce437d80db', name: 'San Tan 18h' },
      { q18Id: 18503,     sbId: '120fcf66-1613-44bc-bd27-2961dc9113c1', name: 'San Tan 9h'  },
    ],
  },
  {
    facilityId: 1030,
    courses: [
      { q18Id: 'default', sbId: 'f43be1a2-c2bb-45cd-aa68-118349acb172', name: 'Scottsdale CC 18h' },
      { q18Id: 18510,     sbId: 'c0bedc8b-6a84-4145-b612-930dd36da8ee', name: 'Scottsdale CC 9h'  },
    ],
  },
];

// ─── Dates (Arizona = always UTC-7) ───────────────────────────────────────

function getAZDates() {
  const azNow = new Date(Date.now() - 7 * 60 * 60 * 1000);
  const azTom = new Date(azNow.getTime() + 24 * 60 * 60 * 1000);
  const fmt = (d: Date, sep = '') => {
    const y   = String(d.getUTCFullYear());
    const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return sep ? `${y}${sep}${m}${sep}${day}` : `${y}${m}${day}`;
  };
  return [
    { yyyymmdd: fmt(azNow), iso: fmt(azNow, '-') },
    { yyyymmdd: fmt(azTom), iso: fmt(azTom, '-') },
  ];
}

// ─── HTML Parsing (zero dependencies) ────────────────────────────────────

function extractRows(html: string): string[] {
  const rows: string[] = [];
  let i = 0;
  while (i < html.length) {
    const s = html.indexOf('<tr', i);
    if (s === -1) break;
    const e = html.indexOf('</tr>', s);
    if (e === -1) break;
    const row = html.slice(s, e + 5);
    if (row.includes('data-time=')) rows.push(row);
    i = e + 5;
  }
  return rows;
}

function extractTds(rowHtml: string): string[] {
  const tds: string[] = [];
  let i = 0;
  while (i < rowHtml.length) {
    const s = rowHtml.indexOf('<td', i);
    if (s === -1) break;
    const e = rowHtml.indexOf('</td>', s);
    if (e === -1) break;
    tds.push(rowHtml.slice(s, e + 5));
    i = e + 5;
  }
  return tds;
}

function getClasses(el: string): string[] {
  const m = el.match(/\bclass="([^"]*)"/i);
  return m ? m[1].trim().split(/\s+/) : [];
}
const hasClass = (el: string, cls: string) => getClasses(el).includes(cls);

function getAttr(el: string, name: string): string | null {
  const m = el.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

function getText(el: string): string {
  return el
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function getStyleProp(snippet: string, prop: string): string | null {
  const m = snippet.match(/\bstyle="([^"]*)"/i);
  if (!m) return null;
  const p = m[1].match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'));
  return p ? p[1].trim() : null;
}

function parsePlayerText(txt: string) {
  const parts = txt.trim().split(/\s+/);
  if (parts.length < 2) return { name: txt.trim(), rate: 'Public', price_cents: 0 };
  const last        = parts[parts.length - 1];
  const hasDollar   = last.startsWith('$');
  const price_cents = hasDollar ? Math.round(parseFloat(last.slice(1)) * 100) : 0;
  const rate        = hasDollar && parts.length >= 3 ? parts[parts.length - 2] : 'Public';
  const nameParts   = hasDollar
    ? (parts.length >= 3 ? parts.slice(0, -2) : parts.slice(0, -1))
    : parts;
  return { name: nameParts.join(' '), rate, price_cents };
}

function scrapeTeeTimes(html: string) {
  return extractRows(html).map(row => {
    const tm = row.match(/data-time="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/i);
    if (!tm) return null;

    const hour   = parseInt(tm[4], 10);
    const minute = parseInt(tm[5], 10);
    const tds    = extractTds(row);

    const resTds   = tds.filter(td => hasClass(td, 'res'));
    const chkinTds = resTds.filter(td => hasClass(td, 'chkin'));
    const nameTds  = resTds.filter(td => !hasClass(td, 'chkin'));
    const addTd    = tds.find(td => hasClass(td, 'addplayer'));
    const priceTd  = tds.find(td => hasClass(td, 'col_Price'));

    const rack_cents  = priceTd
      ? Math.round(parseFloat(getText(priceTd).replace(/[^0-9.]/g, '')) * 100) || 0
      : 0;
    const rowText     = getText(row).toLowerCase();
    const is_blocked  = rowText.includes('blocked') || (resTds.length === 0 && !addTd);

    const players = nameTds.map((td, idx) => {
      const parsed  = parsePlayerText(getText(td));
      const chkinTd = chkinTds[idx] ?? null;
      const divSnip = chkinTd ? (chkinTd.match(/<div([^>]*)>/i)?.[0] ?? '') : '';
      return {
        name:        parsed.name,
        rate:        parsed.rate,
        price_cents: parsed.price_cents,
        is_lead:     idx === 0,
        resv_id:     getAttr(td, 'data-resv'),
        checked_in:  chkinTd ? !hasClass(chkinTd, 'ci') : false,
        color:       divSnip ? getStyleProp(divSnip, 'background-color') : null,
      };
    });

    const open_slots = addTd ? parseInt(getAttr(addTd, 'data-players') ?? '0', 10) : 0;
    return { hour, minute, rack_cents, is_blocked, players, open_slots, max_players: players.length + open_slots };
  }).filter(Boolean);
}

// ─── Auth ────────────────────────────────────────────────────────────────

function parseCookieHeaders(headers: Headers): Record<string, string> {
  const jar: Record<string, string> = {};
  // Deno/fetch: getSetCookie() available in newer versions; fall back to get()
  const list: string[] = (headers as any).getSetCookie?.()
    ?? (headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/);
  for (const sc of list.filter(Boolean)) {
    const nv = sc.split(';')[0];
    const eq = nv.indexOf('=');
    if (eq > 0) jar[nv.slice(0, eq).trim()] = nv.slice(eq + 1).trim();
  }
  return jar;
}

function jarToString(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

const Q18_USER = Deno.env.get('Q18_USERNAME') ?? 'dave@swingfirst.co';
const Q18_PASS = Deno.env.get('Q18_PASSWORD') ?? 'swingfirst';

async function login(): Promise<string> {
  const loginUrl = `${Q18_BASE}/account/logon`;

  // GET login page — pick up pre-auth cookies and any CSRF token
  const getResp   = await fetch(loginUrl, { redirect: 'follow', headers: { 'User-Agent': UA } });
  const loginHtml = await getResp.text();
  const preCookies = parseCookieHeaders(getResp.headers);

  const csrfMatch = loginHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)
                 ?? loginHtml.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/i);
  const csrfToken = csrfMatch?.[1] ?? '';

  const body = new URLSearchParams({ UserName: Q18_USER, Password: Q18_PASS, RememberMe: 'false' });  // eslint-disable-line
  if (csrfToken) body.set('__RequestVerificationToken', csrfToken);

  const preAuthStr = jarToString(preCookies);
  const postResp = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      ...(preAuthStr ? { Cookie: preAuthStr } : {}),
    },
    body: body.toString(),
    redirect: 'manual',
  });

  const allCookies = { ...preCookies, ...parseCookieHeaders(postResp.headers) };
  const cookieStr  = jarToString(allCookies);

  if (postResp.status !== 302 && postResp.status !== 303) {
    const snippet = await postResp.text().catch(() => '');
    throw new Error(`Login returned HTTP ${postResp.status}. Body: ${snippet.slice(0, 200)}`);
  }
  return cookieStr;
}

// ─── Booking meta fetch (DIA + group name) ───────────────────────────────

async function fetchBookingMeta(
  facilityId: number,
  courseId:   number | 'default',
  resvId:     string,
  cookieStr:  string
): Promise<{ dia: number | null; grpName: string | null }> {
  try {
    const r = await fetch(
      `${Q18_BASE}/Facility/${facilityId}/Course/${courseId}/Booking/Details/${resvId}`,
      { headers: { Cookie: cookieStr, 'User-Agent': UA } }
    );
    if (!r.ok) return { dia: null, grpName: null };
    const html = await r.text();

    const diaMatch = html.match(/DIA:\s*(\d+)/);
    const dia = diaMatch ? parseInt(diaMatch[1], 10) : null;

    // Group name lives in a label/value pair: "Reservation Group Name:</xx> <xx>SCARFF - Resend</xx>"
    const grpMatch = html.match(/Reservation Group Name[^<]*<\/[^>]+>\s*<[^>]+>([^<]+)/i);
    let grpName: string | null = null;
    if (grpMatch) {
      // Strip trailing annotations like " - Resend", " - Copy" etc.
      grpName = grpMatch[1].trim().replace(/\s*[-–]\s*(Resend|Copy|Duplicate)\b.*/i, '').trim() || null;
    }

    return { dia, grpName };
  } catch { return { dia: null, grpName: null }; }
}

// ─── Per-sheet sync ───────────────────────────────────────────────────────

async function syncSheet(
  facilityId: number,
  course:     CourseConfig,
  date:       { yyyymmdd: string; iso: string },
  cookieStr:  string
) {
  const url = `${Q18_BASE}/Facility/${facilityId}/Course/${course.q18Id}/TeeSheetView?teedate=${date.yyyymmdd}`;
  try {
    const r = await fetch(url, {
      headers: { Cookie: cookieStr, 'User-Agent': UA },
      redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (/logon|login/i.test(r.url)) throw new Error('Redirected to login — session rejected');

    const html = await r.text();
    if (!html.includes('data-time=')) throw new Error('No tee time data in response');

    const teeTimes = scrapeTeeTimes(html) as any[];

    const resvIds = [...new Set(
      teeTimes.flatMap((tt: any) => tt.players.map((p: any) => p.resv_id).filter(Boolean))
    )] as string[];

    const metaMap: Record<string, { dia: number | null; grpName: string | null }> =
      Object.fromEntries(
        await Promise.all(
          resvIds.map(async id => [id, await fetchBookingMeta(facilityId, course.q18Id, id, cookieStr)])
        )
      );

    for (const tt of teeTimes) {
      const key  = tt.players[0]?.resv_id;
      const meta = key ? metaMap[key] : null;
      tt.dia = meta?.dia ?? null;

      // For GRP bookings, replace first-name-only player names with the group name
      if (meta?.grpName) {
        for (const p of tt.players) {
          if (/^GRP[\s:(]/i.test(p.name)) {
            p.name = meta.grpName;
          }
        }
      }
    }

    const syncResp = await fetch(`${SB_URL}/rest/v1/rpc/sync_quick18_tee_sheet`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ p_course_id: course.sbId, p_date: date.iso, p_tee_times: teeTimes }),
    });
    const syncText = await syncResp.text();
    if (!syncResp.ok) throw new Error(`Supabase error: ${syncText}`);

    return {
      course: course.name, date: date.iso,
      tee_times: teeTimes.length,
      booked:    teeTimes.filter((t: any) => t.players.length > 0).length,
      dia:       Object.values(metaMap).filter(m => m.dia !== null).length,
      msg:       syncText.replace(/^"|"$/g, ''),
    };
  } catch (e: any) {
    return { course: course.name, date: date.iso, error: e.message };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────

serve(async (_req: Request) => {
  const start = new Date().toISOString();
  console.log(`[Q18 Sync] Starting — ${start}`);

  const dates = getAZDates();

  let cookieStr: string;
  try {
    cookieStr = await login();
    console.log('[Q18 Sync] Login OK');
  } catch (e: any) {
    console.error('[Q18 Sync] Login failed:', e.message);
    return new Response(`Login failed: ${e.message}`, { status: 500 });
  }

  // All sheets (5 facilities × 2 courses × 2 dates = 20) in parallel
  const results = await Promise.all(
    FACILITIES.flatMap(fac =>
      fac.courses.flatMap(course =>
        dates.map(date => syncSheet(fac.facilityId, course, date, cookieStr))
      )
    )
  );

  const summary = results.map((r: any) =>
    r.error
      ? `  ✗ ${r.course} ${r.date}: ${r.error}`
      : `  ✓ ${r.course} ${r.date}: ${r.tee_times} tee times (${r.booked} booked, ${r.dia} DIA)`
  ).join('\n');

  console.log('[Q18 Sync] Done:\n' + summary);
  return new Response(summary, { status: 200, headers: { 'Content-Type': 'text/plain' } });
});
