const express = require('express');
const path = require('path');
const supabase = require('./conn');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------------------------------------------------------------------
// Turn cryptic database/network errors into something you can act on.
// Raw errors like "TypeError: fetch failed" are meaningless in the UI.
// ---------------------------------------------------------------------------
function friendlyError(err) {
    const msg = String((err && err.message) || err || 'Unknown error');
    const detail = String((err && err.details) || '');
    const all = `${msg} ${detail}`;

    if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(all)) {
        return 'Cannot reach the database. The Supabase project in .env was not found - '
            + 'it may have been deleted, or .env was edited. '
            + 'RESTART THE SERVER (stop node app.js and run it again) after any .env change.';
    }
    if (/Project removed|Invalid API key|JWT|Invalid.*claims/i.test(all)) {
        return 'Supabase rejected the credentials in .env - the project was deleted or the key is wrong. '
            + 'RESTART THE SERVER (stop node app.js and run it again) after any .env change.';
    }
    if (/row-level security/i.test(all)) {
        return 'Permission denied by the database (missing RLS policy). '
            + 'Run rls-policies.sql in the Supabase SQL Editor.';
    }
    if (/payment_method/i.test(all) && /does not exist|schema cache|Could not find/i.test(all)) {
        return 'The sales table is missing the payment_method column. '
            + 'Run shema.sql in the Supabase SQL Editor, then restart the server.';
    }
    if (/does not exist|schema cache|Could not find the table/i.test(all)) {
        return 'A table is missing in this Supabase project. '
            + 'Run shema.sql in the SQL Editor for this project.';
    }
    return msg;
}

// ---------------------------------------------------------------------------
// PAGES
// ---------------------------------------------------------------------------
// Daily sales / receptionist shift page
app.get('/', (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    res.render('index', {
        title: 'Daily Sales Report',
        companyName: 'SPAradise',
        defaultDate: today
    });
});

// Monthly sales archive page
app.get('/monthly', (req, res) => {
    const now = new Date();
    const currentMonth =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    res.render('monthly', {
        title: 'Monthly Sales Data',
        companyName: 'SPAradise',
        defaultMonth: currentMonth
    });
});

// Weekly sales archive page
app.get('/weekly', (req, res) => {
    res.render('weekly', {
        title: 'Weekly Sales Data',
        companyName: 'SPAradise',
        defaultWeek: currentIsoWeek()
    });
});

// ---------------------------------------------------------------------------
// ISO-8601 WEEK HELPERS (weeks run Monday -> Sunday)
// ---------------------------------------------------------------------------
// "2026-W42" -> { start: '2026-10-12', end: '2026-10-18' }
function isoWeekBounds(week) {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(String(week || '').trim());
    if (!m) return null;

    const year = Number(m[1]);
    const weekNo = Number(m[2]);
    if (weekNo < 1 || weekNo > 53) return null;

    // Jan 4th is always in ISO week 1; find that week's Monday.
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dow = jan4.getUTCDay() || 7; // Mon=1 ... Sun=7
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (weekNo - 1) * 7);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const iso = d => d.toISOString().slice(0, 10);
    return { start: iso(monday), end: iso(sunday) };
}

// The ISO week containing today, formatted for <input type="week">.
function currentIsoWeek(when) {
    const d = new Date(when || Date.now());
    const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dow = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - dow); // Thursday of this week

    const isoYear = utc.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);

    return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// RECEPTIONISTS (registration + list for the login dropdown)
// ---------------------------------------------------------------------------
app.get('/api/receptionists', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('receptionists')
            .select('*')
            .order('shift', { ascending: true })
            .order('name', { ascending: true });

        if (error) throw error;

        res.json({ success: true, data: data });
    } catch (err) {
        console.error('Error fetching receptionists:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

app.post('/api/receptionists', async (req, res) => {
    try {
        const name = (req.body.name || '').trim();
        const shift = (req.body.shift || '').trim().toLowerCase();

        if (!name) {
            return res.status(400).json({ success: false, error: 'Name is required.' });
        }
        if (shift !== 'morning' && shift !== 'night') {
            return res.status(400).json({ success: false, error: 'Please choose a valid shift (morning or night).' });
        }

        // Prevent duplicate receptionist with the same name + shift
        const { data: existing, error: findError } = await supabase
            .from('receptionists')
            .select('id')
            .ilike('name', name)
            .eq('shift', shift)
            .limit(1);

        if (findError) throw findError;
        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                error: `${name} is already registered for the ${shift} shift.`
            });
        }

        const { data, error } = await supabase
            .from('receptionists')
            .insert([{ name: name, shift: shift }])
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, data: data });
    } catch (err) {
        console.error('Error adding receptionist:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// Receptionist profile: details + a few activity stats for the profile menu.
app.get('/api/receptionists/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (!/^\d+$/.test(String(id))) {
            return res.status(400).json({ success: false, error: 'Invalid receptionist id.' });
        }

        const { data: receptionist, error } = await supabase
            .from('receptionists')
            .select('id, name, shift, created_at')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        if (!receptionist) {
            return res.status(404).json({ success: false, error: 'Receptionist profile not found.' });
        }

        const { count: shiftsWorked, error: shiftError } = await supabase
            .from('shift_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('receptionist_id', id);

        if (shiftError) throw shiftError;

        const { count: recordsLogged, error: salesError } = await supabase
            .from('sales')
            .select('id', { count: 'exact', head: true })
            .eq('receptionist', receptionist.name)
            .eq('shift', receptionist.shift);

        if (salesError) throw salesError;

        res.json({
            success: true,
            data: {
                ...receptionist,
                shifts_worked: shiftsWorked || 0,
                records_logged: recordsLogged || 0
            }
        });
    } catch (err) {
        console.error('Error fetching receptionist profile:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// A receptionist may delete her own account while she is the one on shift.
// Sales records are kept (they store her name as text); only the login
// profile and its shift-session links are removed.
app.delete('/api/receptionists/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const sessionId = req.body && req.body.session_id;
        const confirmName = req.body && req.body.confirm_name;

        if (!/^\d+$/.test(String(id))) {
            return res.status(400).json({ success: false, error: 'Invalid receptionist id.' });
        }
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Your active shift was not found. Please log in again.'
            });
        }

        // The session proves which profile is currently logged in. Without this
        // check any name in the login dropdown could delete any other profile.
        const { data: session, error: sessionError } = await supabase
            .from('shift_sessions')
            .select('id, receptionist_id, shift, status')
            .eq('id', sessionId)
            .maybeSingle();

        if (sessionError) throw sessionError;
        if (!session || session.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Your shift is no longer active. Please log in again.'
            });
        }
        if (String(session.receptionist_id) !== String(id)) {
            return res.status(403).json({
                success: false,
                error: 'You can only delete your own account.'
            });
        }

        const { data: receptionist, error: findError } = await supabase
            .from('receptionists')
            .select('id, name')
            .eq('id', id)
            .maybeSingle();

        if (findError) throw findError;
        if (!receptionist) {
            return res.status(404).json({ success: false, error: 'This profile was already deleted.' });
        }

        if (!confirmName ||
            String(confirmName).trim().toLowerCase() !==
            String(receptionist.name).trim().toLowerCase()) {
            return res.status(400).json({
                success: false,
                error: 'Type your full name to confirm account deletion.'
            });
        }

        // End the shift first so a deleted profile cannot stay "logged in".
        const { error: endError } = await supabase
            .from('shift_sessions')
            .update({ status: 'completed', logout_at: new Date().toISOString() })
            .eq('id', session.id);

        if (endError) throw endError;

        // Detach old shift sessions. The schema declares ON DELETE SET NULL,
        // but doing it explicitly also works if the live FK was created
        // differently.
        const { error: detachError } = await supabase
            .from('shift_sessions')
            .update({ receptionist_id: null })
            .eq('receptionist_id', id);

        if (detachError) throw detachError;

        const { error: deleteError } = await supabase
            .from('receptionists')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        res.json({ success: true, id: id, name: receptionist.name });
    } catch (err) {
        console.error('Error deleting receptionist account:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// ---------------------------------------------------------------------------
// SHIFT SESSIONS (start / end / current active)
// ---------------------------------------------------------------------------
app.get('/api/sessions/active', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('shift_sessions')
            .select('*')
            .eq('status', 'active')
            .order('id', { ascending: false })
            .limit(1);

        if (error) throw error;

        res.json({ success: true, data: (data && data[0]) || null });
    } catch (err) {
        console.error('Error fetching active session:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

app.post('/api/sessions/start', async (req, res) => {
    try {
        const receptionistId = req.body.receptionist_id;

        if (!receptionistId) {
            return res.status(400).json({ success: false, error: 'Please select a receptionist.' });
        }

        const { data: receptionist, error: rErr } = await supabase
            .from('receptionists')
            .select('*')
            .eq('id', receptionistId)
            .single();

        if (rErr || !receptionist) {
            return res.status(400).json({ success: false, error: 'Receptionist not found.' });
        }

        // Only one active shift at a time: close any lingering active session.
        await supabase
            .from('shift_sessions')
            .update({ status: 'completed', logout_at: new Date().toISOString() })
            .eq('status', 'active');

        const { data: session, error: sErr } = await supabase
            .from('shift_sessions')
            .insert([{
                receptionist_id: receptionist.id,
                receptionist_name: receptionist.name,
                shift: receptionist.shift
            }])
            .select()
            .single();

        if (sErr) throw sErr;

        res.json({
            success: true,
            data: {
                id: session.id,
                receptionist_id: receptionist.id,
                receptionist_name: receptionist.name,
                shift: receptionist.shift
            }
        });
    } catch (err) {
        console.error('Error starting session:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

app.post('/api/sessions/end', async (req, res) => {
    try {
        const sessionId = req.body.session_id;

        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'Session not found.' });
        }

        const { data: session, error: sErr } = await supabase
            .from('shift_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (sErr || !session) {
            return res.status(400).json({ success: false, error: 'Session not found.' });
        }

        // When the NIGHT shift logs out, the day it worked is closed: every
        // un-archived sale for that shift's work_date moves into the monthly
        // sales data. Sales recorded after midnight (report_date = the next
        // day) are deliberately left open so the morning shift can log them.
        let archivedCount = 0;
        if (session.shift === 'night' && session.work_date) {
            const { data: archivedRows, error: aErr } = await supabase
                .from('sales')
                .update({ archived: true })
                .eq('archived', false)
                .eq('report_date', session.work_date)
                .select();

            if (aErr) throw aErr;
            archivedCount = (archivedRows && archivedRows.length) || 0;
        }

        const { error: upErr } = await supabase
            .from('shift_sessions')
            .update({ status: 'completed', logout_at: new Date().toISOString() })
            .eq('id', sessionId);

        if (upErr) throw upErr;

        res.json({
            success: true,
            archived: archivedCount
        });
    } catch (err) {
        console.error('Error ending session:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
// A day is "closed" once any of its rows has been archived (night-shift logout
// or the manual "Save Day to Monthly" button). Closed days are read-only.
async function isDayClosed(date) {
    if (!date) return false;

    const { data, error } = await supabase
        .from('sales')
        .select('id')
        .eq('report_date', date)
        .eq('archived', true)
        .limit(1);

    if (error) throw error;
    return !!(data && data.length > 0);
}

// Sales may only be written while a receptionist is actually on shift.
// After the last shift logs out there is no active session, so all writes stop.
async function hasActiveSession() {
    const { data, error } = await supabase
        .from('shift_sessions')
        .select('id')
        .eq('status', 'active')
        .limit(1);

    if (error) throw error;
    return !!(data && data.length > 0);
}

// 'cash' = paid at the counter, 'epay' = paid online. Anything else is
// rejected so the reports can always trust the value.
function parsePaymentMethod(value) {
    const method = String(value || 'cash').trim().toLowerCase();
    return method === 'cash' || method === 'epay' ? method : null;
}

// Session duration in hours: 1, 1.5 or 2. Returns undefined when omitted
// (so an edit can keep the stored value) and null when invalid.
function parseDuration(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const duration = Number(value);
    return duration === 1 || duration === 1.5 || duration === 2 ? duration : null;
}

// Totals for the summary cards. Older rows created before payment methods
// existed have no payment_method value, so they count as cash.
function summarizeSales(rows) {
    const summary = {
        count: 0,
        total: 0,
        comm: 0,
        net: 0,
        cash: 0,
        cash_count: 0,
        epay: 0,
        epay_count: 0
    };

    (rows || []).forEach(row => {
        const total = Number(row.total) || 0;
        const comm = Number(row.comm) || 0;
        const isEpay = String(row.payment_method || '').toLowerCase() === 'epay';

        summary.count += 1;
        summary.total += total;
        summary.comm += comm;

        if (isEpay) {
            summary.epay += total;
            summary.epay_count += 1;
        } else {
            summary.cash += total;
            summary.cash_count += 1;
        }
    });

    summary.net = summary.total - summary.comm;
    return summary;
}

// ---------------------------------------------------------------------------
// SALES
// ---------------------------------------------------------------------------
// Get sales (optionally filtered by ?date=YYYY-MM-DD)
app.get('/api/sales', async (req, res) => {
    try {
        let query = supabase
            .from('sales')
            .select('*')
            .order('id', { ascending: true });

        if (req.query.date) {
            query = query.eq('report_date', req.query.date);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Tell the UI whether this date is already closed, so the add-form can
        // be locked even on a day that ended with zero sales.
        const closed = req.query.date ? await isDayClosed(req.query.date) : false;

        res.json({
            success: true,
            data: data,
            closed: closed,
            summary: summarizeSales(data)
        });
    } catch (err) {
        console.error('Error fetching sales:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// Add sale
app.post('/api/sales', async (req, res) => {
    try {
        const {
            name,
            service,
            room,
            time,
            duration,
            total,
            comm,
            payment_method,
            report_date,
            receptionist,
            shift
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Staff name is required.' });
        }

        // 'cash' = paid at the counter, 'epay' = paid online. Anything else is
        // rejected so the reports can always trust the value.
        const paymentMethod = parsePaymentMethod(payment_method);
        if (!paymentMethod) {
            return res.status(400).json({
                success: false,
                error: 'Payment method must be either cash or epay.'
            });
        }

        const parsedDuration = parseDuration(duration);
        if (parsedDuration === null) {
            return res.status(400).json({
                success: false,
                error: 'Session duration must be 1, 1.5 or 2 hours.'
            });
        }
        const durationVal = parsedDuration === undefined ? 1 : parsedDuration;

        const dateVal = report_date || new Date().toISOString().split('T')[0];

        // 1) Once a day is closed it stays closed. Without this check a single
        //    late insert (from a stale tab or a direct API call) re-opened the
        //    whole day, because its row arrived with archived = false.
        if (await isDayClosed(dateVal)) {
            return res.status(403).json({
                success: false,
                error: 'This day is already closed and saved to Monthly Sales Data. New records cannot be added.'
            });
        }

        // 2) Sales may only be recorded while a receptionist is on shift.
        //    After the last shift logs out, no active session exists -> blocked.
        if (!(await hasActiveSession())) {
            return res.status(403).json({
                success: false,
                error: 'No shift is active. Please log in before adding sales.'
            });
        }

        const { data, error } = await supabase
            .from('sales')
            .insert([{
                name: name,
                service: service || '',
                room: room || '',
                time: time || '',
                duration: durationVal,
                total: total || 0,
                comm: comm || 0,
                payment_method: paymentMethod,
                report_date: dateVal,
                receptionist: receptionist || '',
                shift: shift || ''
            }])
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, data: data });
    } catch (err) {
        console.error('Error adding sale:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// Edit sale (blocked once the day is archived / read-only)
app.put('/api/sales/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!/^\d+$/.test(String(id))) {
            return res.status(400).json({ success: false, error: 'Invalid record id.' });
        }

        const { data: row, error: findError } = await supabase
            .from('sales')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (findError) throw findError;
        if (!row) {
            return res.status(404).json({ success: false, error: 'Record not found.' });
        }

        if (row.archived) {
            return res.status(403).json({
                success: false,
                error: 'This record is archived (read-only) and can no longer be edited.'
            });
        }

        if (await isDayClosed(row.report_date)) {
            return res.status(403).json({
                success: false,
                error: 'This day is already closed and saved to Monthly Sales Data. Records cannot be edited.'
            });
        }

        if (!(await hasActiveSession())) {
            return res.status(403).json({
                success: false,
                error: 'No shift is active. Please log in before changing records.'
            });
        }

        const { name, service, room, time, duration, total, comm, payment_method } = req.body;
        const trimmedName = String(name || '').trim();

        if (!trimmedName) {
            return res.status(400).json({ success: false, error: 'Staff name is required.' });
        }

        // If payment_method is omitted entirely, keep the record's current
        // method instead of silently turning an E-Pay sale into cash.
        const paymentMethod = (payment_method === undefined || payment_method === null || payment_method === '')
            ? parsePaymentMethod(row.payment_method)
            : parsePaymentMethod(payment_method);

        if (!paymentMethod) {
            return res.status(400).json({
                success: false,
                error: 'Payment method must be either cash or epay.'
            });
        }

        const parsedDuration = parseDuration(duration);
        if (parsedDuration === null) {
            return res.status(400).json({
                success: false,
                error: 'Session duration must be 1, 1.5 or 2 hours.'
            });
        }
        const durationVal = parsedDuration === undefined ? row.duration : parsedDuration;

        // report_date, receptionist and shift are kept as originally recorded;
        // the editable fields are the ones visible on the sales table/card.
        // Fields omitted from the request keep their current value.
        const { data, error } = await supabase
            .from('sales')
            .update({
                name: trimmedName,
                service: service !== undefined ? (service || '') : (row.service || ''),
                room: room !== undefined ? (room || '') : (row.room || ''),
                time: time !== undefined ? (time || '') : (row.time || ''),
                duration: durationVal,
                total: total !== undefined ? (total || 0) : row.total,
                comm: comm !== undefined ? (comm || 0) : row.comm,
                payment_method: paymentMethod
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, data: data });
    } catch (err) {
        console.error('Error updating sale:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// Delete sale (blocked once the day is archived / read-only)
app.delete('/api/sales/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: row, error: fErr } = await supabase
            .from('sales')
            .select('archived')
            .eq('id', id)
            .single();

        if (fErr || !row) {
            return res.status(404).json({ success: false, error: 'Record not found.' });
        }

        if (row.archived) {
            return res.status(403).json({
                success: false,
                error: 'This record is archived (read-only) and can no longer be deleted.'
            });
        }

        if (!(await hasActiveSession())) {
            return res.status(403).json({
                success: false,
                error: 'No shift is active. Please log in before changing records.'
            });
        }

        const { error } = await supabase
            .from('sales')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true, id: id });
    } catch (err) {
        console.error('Error deleting sale:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// Manually close & archive a single day (used when no night shift comes in)
app.post('/api/sales/archive-day', async (req, res) => {
    try {
        const date = req.body.date || new Date().toISOString().split('T')[0];

        const { data: rows, error } = await supabase
            .from('sales')
            .update({ archived: true })
            .eq('report_date', date)
            .eq('archived', false)
            .select();

        if (error) throw error;

        res.json({ success: true, archived: (rows && rows.length) || 0, date: date });
    } catch (err) {
        console.error('Error archiving day:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// ---------------------------------------------------------------------------
// MONTHLY SALES DATA (archived records grouped by day)
// ---------------------------------------------------------------------------
app.get('/api/monthly', async (req, res) => {
    try {
        const month = req.query.month; // YYYY-MM
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, error: 'A valid month (YYYY-MM) is required.' });
        }

        const [year, mon] = month.split('-').map(Number);
        const firstDay = `${month}-01`;
        const nextMonthFirst = mon === 12
            ? `${year + 1}-01-01`
            : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

        const { data, error } = await supabase
            .from('sales')
            .select('*')
            .eq('archived', true)
            .gte('report_date', firstDay)
            .lt('report_date', nextMonthFirst)
            .order('report_date', { ascending: true })
            .order('id', { ascending: true });

        if (error) throw error;

        res.json({
            success: true,
            data: data || [],
            summary: summarizeSales(data)
        });
    } catch (err) {
        console.error('Error fetching monthly sales:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// Weekly sales archive (archived rows inside the requested ISO week)
app.get('/api/weekly', async (req, res) => {
    try {
        const week = req.query.week || currentIsoWeek();
        const bounds = isoWeekBounds(week);

        if (!bounds) {
            return res.status(400).json({
                success: false,
                error: 'A valid week (YYYY-Www) is required.'
            });
        }

        const { data, error } = await supabase
            .from('sales')
            .select('*')
            .eq('archived', true)
            .gte('report_date', bounds.start)
            .lte('report_date', bounds.end)
            .order('report_date', { ascending: true })
            .order('id', { ascending: true });

        if (error) throw error;

        res.json({
            success: true,
            data: data || [],
            week: week,
            weekStart: bounds.start,
            weekEnd: bounds.end,
            summary: summarizeSales(data)
        });
    } catch (err) {
        console.error('Error fetching weekly sales:', err);
        res.status(500).json({ success: false, error: friendlyError(err) });
    }
});

// Export the Express app so Vercel can run it as a serverless function.
module.exports = app;

// Only bind a port when the file is started directly (local development or a
// traditional Node host). Vercel imports the export above instead.
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
