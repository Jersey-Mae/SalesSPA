// Tests the NEW archive rule: night-shift logout closes only the shift's own
// work_date, leaving the next day open for the morning shift.
// Uses far-future dates + a temp receptionist; never touches real records.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BASE = 'http://localhost:3000';
const NIGHT_DAY = '2099-12-31';   // the day the night shift worked (gets closed)
const NEXT_DAY = '2100-01-01';    // day after (must stay open)
const NAME = '__archive_rule_test__';

const get = p => fetch(BASE + p).then(async r => ({ status: r.status, json: await r.json() }));
const post = (p, b) => fetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
}).then(async r => ({ status: r.status, json: await r.json() }));

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
    cond ? pass++ : fail++;
};

// Pause any live shift so the "no active shift" assertion holds, then restore
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
    // ---- setup: temp receptionist + one sale on each of the two dates ----
    await pauseLiveSessions();
    const { data: rec } = await supabase
        .from('receptionists').insert([{ name: NAME, shift: 'night' }]).select().single();

    await supabase.from('sales').delete().in('report_date', [NIGHT_DAY, NEXT_DAY]);
    const { data: sales } = await supabase.from('sales').insert([
        { name: 'T-A', report_date: NIGHT_DAY, total: 1, shift: 'night', receptionist: NAME },
        { name: 'T-B', report_date: NEXT_DAY, total: 2, shift: 'night', receptionist: NAME }
    ]).select();

    // A night session that logged in on NIGHT_DAY (work_date is what gets closed)
    const { data: sess } = await supabase.from('shift_sessions').insert([{
        receptionist_id: rec.id, receptionist_name: NAME, shift: 'night',
        work_date: NIGHT_DAY, status: 'active'
    }]).select().single();

    // ---- the actual test: night shift logs out ----
    const end = await post('/api/sessions/end', { session_id: sess.id });
    check('Night logout succeeds', end.json.success === true, JSON.stringify(end.json));

    const { data: after } = await supabase
        .from('sales').select('report_date, archived').in('report_date', [NIGHT_DAY, NEXT_DAY]);
    const a = after.find(r => r.report_date === NIGHT_DAY);
    const b = after.find(r => r.report_date === NEXT_DAY);

    check(`The shift's own day (${NIGHT_DAY}) is archived`, a && a.archived === true, JSON.stringify(a));
    check(`The NEXT day (${NEXT_DAY}) stays open`, b && b.archived === false, JSON.stringify(b));

    // ---- API reports the same state to the UI ----
    let r = await get(`/api/sales?date=${NIGHT_DAY}`);
    check('GET says the worked day is closed', r.json.closed === true, JSON.stringify(r.json.closed));

    r = await get(`/api/sales?date=${NEXT_DAY}`);
    check('GET says the next day is open', r.json.closed === false, JSON.stringify(r.json.closed));

    // ---- after logout there is no active session -> writes blocked ----
    r = await post('/api/sales', { name: 'X', report_date: NEXT_DAY, total: 5 });
    check('POST still blocked right after logout (no active shift)',
        r.status === 403, `${r.status} ${r.json.error}`);

    // ---- with a shift active, the next day accepts sales ----
    await supabase.from('shift_sessions').update({ status: 'completed' }).eq('id', sess.id);
    const { data: s2 } = await supabase.from('shift_sessions').insert([{
        receptionist_id: rec.id, receptionist_name: NAME, shift: 'morning',
        work_date: NEXT_DAY, status: 'active'
    }]).select().single();

    r = await post('/api/sales', { name: 'T-C', report_date: NEXT_DAY, total: 3 });
    check('Morning shift CAN record on the next day', r.status === 200, `${r.status} ${r.json.error}`);

    // closed day is still refused even while on shift
    r = await post('/api/sales', { name: 'T-D', report_date: NIGHT_DAY, total: 4 });
    check('Closed day refused even while on shift',
        r.status === 403 && /closed/i.test(r.json.error), `${r.status} ${r.json.error}`);

    // ---- cleanup ----
    await supabase.from('shift_sessions').delete().eq('id', s2.id);
    await supabase.from('sales').delete().in('report_date', [NIGHT_DAY, NEXT_DAY]);
    await supabase.from('shift_sessions').delete().eq('receptionist_name', NAME);
    await supabase.from('receptionists').delete().eq('id', rec.id);
    await restoreLiveSessions();
    if (liveSessions.length) {
        console.log(`Restored ${liveSessions.length} live shift session(s) that were paused.`);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
