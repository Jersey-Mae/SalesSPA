// Tests the new Weekly Sales feature + the auto-save flow.
// Uses far-future dates and a temp receptionist; real records are never touched.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BASE = 'http://localhost:3000';
const TEMP_DATE = '2099-12-31';
const NAME = '__weekly_test__';

const get = async p => {
    const r = await fetch(BASE + p);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* HTML page, not JSON */ }
    return { status: r.status, json: json, text: text };
};

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
    cond ? pass++ : fail++;
};

// Independent ISO-week calculator (Thursday-of-week method) for cross-checking
function isoWeekOf(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    const dow = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - dow);
    const isoYear = utc.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

(async () => {
    // ---- 1. ISO week boundaries are correct ----
    let r = await get('/api/weekly?week=2026-W01');
    check('2026-W01 starts Mon 2025-12-29',
        r.json.weekStart === '2025-12-29', r.json.weekStart);
    check('2026-W01 ends Sun 2026-01-04',
        r.json.weekEnd === '2026-01-04', r.json.weekEnd);

    r = await get('/api/weekly?week=2026-W53');
    check('2026-W53 starts Mon 2026-12-28',
        r.json.weekStart === '2026-12-28', r.json.weekStart);
    check('2026-W53 ends Sun 2027-01-03',
        r.json.weekEnd === '2027-01-03', r.json.weekEnd);

    // ---- 2. Bad input rejected ----
    r = await get('/api/weekly?week=nonsense');
    check('Invalid week returns 400', r.status === 400, `${r.status}`);

    // ---- 3. Auto-save flow: archive a sale -> it shows up in Weekly ----
    const { data: rec } = await supabase
        .from('receptionists').insert([{ name: NAME, shift: 'night' }]).select().single();

    await supabase.from('sales').delete().eq('report_date', TEMP_DATE);
    const { data: sale } = await supabase.from('sales').insert([{
        name: 'W-Test', report_date: TEMP_DATE, total: 750, comm: 150,
        shift: 'night', receptionist: NAME, archived: false
    }]).select().single();

    const week = isoWeekOf(TEMP_DATE);
    r = await get(`/api/weekly?week=${week}`);
    check('Unarchived sale NOT in weekly yet',
        !(r.json.data || []).some(x => x.id === sale.id), JSON.stringify(r.json.data));

    // the "Save Day" action (what night-shift logout triggers)
    const archPost = await fetch(BASE + '/api/sales/archive-day', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: TEMP_DATE })
    }).then(x => x.json());
    check('Day archived automatically', archPost.success === true, JSON.stringify(archPost));

    r = await get(`/api/weekly?week=${week}`);
    check('Archived sale now appears in Weekly Sales',
        (r.json.data || []).some(x => x.id === sale.id), JSON.stringify(r.json.data));
    check('Weekly response carries weekStart/weekEnd',
        !!r.json.weekStart && !!r.json.weekEnd, JSON.stringify({ s: r.json.weekStart, e: r.json.weekEnd }));

    // ---- 4. It is in Monthly too (same archive = both views) ----
    const month = TEMP_DATE.slice(0, 7);
    const mon = await get(`/api/monthly?month=${month}`);
    check('Same sale appears in Monthly Sales',
        (mon.json.data || []).some(x => x.id === sale.id), JSON.stringify(mon.json.data));

    // ---- 5. Daily page reports the day closed (drives the auto-advance) ----
    const daily = await get(`/api/sales?date=${TEMP_DATE}`);
    check('Daily API reports day closed (drives login auto-advance)',
        daily.json.closed === true, JSON.stringify(daily.json.closed));

    // ---- 6. Pages render with the new UI ----
    const weeklyPage = await get('/weekly');
    check('/weekly page renders', weeklyPage.status === 200, `${weeklyPage.status}`);
    check('/weekly has a week picker',
        weeklyPage.text.includes('type="week"') && weeklyPage.text.includes('id="week-picker"'), 'missing picker');
    check('/weekly defaults to a real ISO week',
        /value="\d{4}-W\d{2}"/.test(weeklyPage.text), 'no default week');

    const home = await get('/');
    check('Daily page links to Weekly Sales Data', home.text.includes('/weekly'), 'missing link');
    check('Daily page offers Save to Weekly &amp; Monthly',
        home.text.includes('Save Day to Weekly'), 'missing button label');
    check('Register/login UI untouched',
        home.text.includes('id="register-form"') && home.text.includes('id="login-form"'),
        'login/register markup changed!');

    const monthlyPage = await get('/monthly');
    check('/monthly links to Weekly', monthlyPage.text.includes('/weekly'), 'missing link');

    // ---- cleanup ----
    await supabase.from('sales').delete().eq('report_date', TEMP_DATE);
    await supabase.from('shift_sessions').delete().eq('receptionist_name', NAME);
    await supabase.from('receptionists').delete().eq('id', rec.id);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
