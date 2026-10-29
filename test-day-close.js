// End-to-end test of the "day close / shift logout" write guards.
// Uses a far-future test date so it never touches real records, then cleans up.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BASE = 'http://localhost:3000';
const TEST_DATE = '2099-12-31';
const NAME = '__guard_test__';

const post = (path, body) =>
    fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(async r => ({ status: r.status, json: await r.json() }));

const get = path => fetch(BASE + path).then(async r => ({ status: r.status, json: await r.json() }));

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
    cond ? pass++ : fail++;
};

// Pause any live shift so the "no active shift" assertions hold, then restore
// it at the end - this test must never sign a real receptionist out.
let liveSessions = [];
const pauseLiveSessions = async () => {
    const { data } = await supabase.from('shift_sessions').select('*').eq('status', 'active');
    liveSessions = data || [];
    for (const s of liveSessions) {
        await supabase.from('shift_sessions').update({ status: 'completed' }).eq('id', s.id);
    }
};
const restoreLiveSessions = async () => {
    for (const s of liveSessions) {
        await supabase.from('shift_sessions').update({ status: 'active', logout_at: null }).eq('id', s.id);
    }
};

(async () => {
    // ---- setup: a receptionist + a test date that is guaranteed open ----
    await pauseLiveSessions();
    const { data: rec } = await supabase
        .from('receptionists').insert([{ name: NAME, shift: 'morning' }]).select().single();
    await supabase.from('sales').delete().eq('report_date', TEST_DATE);

    // 1. No shift active at all -> must be blocked
    let r = await post('/api/sales', { name: 'Therapist', total: 100, report_date: TEST_DATE });
    check('POST blocked when nobody is on shift',
        r.status === 403 && /log in/i.test(r.json.error), `${r.status} ${r.json.error}`);

    // 2. GET reports the day as open
    r = await get(`/api/sales?date=${TEST_DATE}`);
    check('GET reports day as open before closing',
        r.json.closed === false, JSON.stringify(r.json.closed));

    // 3. Receptionist logs in -> write is allowed
    const sess = await post('/api/sessions/start', { receptionist_id: rec.id });
    check('Shift session started', sess.json.success === true, JSON.stringify(sess.json));

    r = await post('/api/sales', { name: 'Therapist', total: 100, report_date: TEST_DATE });
    check('POST allowed while on shift', r.status === 200 && r.json.success === true,
        `${r.status} ${r.json.error}`);
    const saleId = r.json.data && r.json.data.id;

    // 4. Close the day (same as night-shift logout)
    r = await post('/api/sales/archive-day', { date: TEST_DATE });
    check('Day archived', r.json.success === true, JSON.stringify(r.json));

    // 5. NOW: a stale tab tries to add -> must be rejected even though a shift is live
    r = await post('/api/sales', { name: 'Therapist', total: 100, report_date: TEST_DATE });
    check('POST blocked after day is closed (shift still active)',
        r.status === 403 && /closed/i.test(r.json.error), `${r.status} ${r.json.error}`);

    // 6. Deleting an archived row is blocked
    r = await fetch(`${BASE}/api/sales/${saleId}`, { method: 'DELETE' }).then(async x => ({ status: x.status, json: await x.json() }));
    check('DELETE blocked on archived row', r.status === 403, `${r.status} ${r.json.error}`);

    // 7. GET now reports the day as closed
    r = await get(`/api/sales?date=${TEST_DATE}`);
    check('GET reports day as closed', r.json.closed === true, JSON.stringify(r.json.closed));

    // 8. Last shift logs out -> no active session -> writes blocked again
    await post('/api/sessions/end', { session_id: sess.json.data.id });
    await supabase.from('sales').delete().neq('id', 0).eq('report_date', TEST_DATE);
    r = await post('/api/sales', { name: 'Therapist', total: 100, report_date: TEST_DATE });
    check('POST blocked after last shift logout',
        r.status === 403, `${r.status} ${r.json.error}`);

    // 9. A brand-new day (next morning) is still writable
    const TOMORROW = '2099-12-30';
    await supabase.from('sales').delete().eq('report_date', TOMORROW);
    const sess2 = await post('/api/sessions/start', { receptionist_id: rec.id });
    r = await post('/api/sales', { name: 'Therapist', total: 100, report_date: TOMORROW });
    check('Next day still accepts sales (not locked by yesterday)',
        r.status === 200, `${r.status} ${r.json.error}`);

    // ---- cleanup ----
    await post('/api/sessions/end', { session_id: sess2.json.data.id });
    await supabase.from('sales').delete().neq('id', 0).in('report_date', [TEST_DATE, TOMORROW]);
    await supabase.from('shift_sessions').delete().like('receptionist_name', NAME);
    await supabase.from('receptionists').delete().eq('id', rec.id);
    await restoreLiveSessions();
    if (liveSessions.length) {
        console.log(`Restored ${liveSessions.length} live shift session(s) that were paused.`);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
