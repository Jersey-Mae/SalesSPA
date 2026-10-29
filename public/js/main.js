let salesData = [];
let currentSession = null; // { id, receptionist_name, shift }
let dayClosed = false;     // true when the selected date is fully archived
let dayClosedOnServer = false; // server-confirmed: the selected date is archived
let editingSaleId = null;  // id of the record currently loaded in the form
let editingStartTime = ''; // original start time kept while editing

const PESO = '\u20b1';

// ---------------------------------------------------------------------------
// TIME / DURATION HELPERS
// ---------------------------------------------------------------------------
// Session duration is stored in hours: 1, 1.5 or 2.
function durationLabel(duration) {
    const hours = Number(duration);
    if (hours === 1) return '1 hr';
    if (hours === 1.5) return '1.5 hrs';
    if (hours === 2) return '2 hrs';
    return '';
}

// "1:09 PM" / "13:09" -> minutes since midnight (null when unparseable).
function parseTimeToMinutes(value) {
    const match = /^(\d{1,2}):(\d{1,2})\s*(AM|PM)?$/i.exec(String(value || '').trim());
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = (match[3] || '').toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

// minutes since midnight -> "h:mm AM/PM" (wraps after midnight)
function formatMinutesAsTime(totalMinutes) {
    const minutesInDay = 24 * 60;
    const minutes = ((Math.round(totalMinutes) % minutesInDay) + minutesInDay) % minutesInDay;
    const hours24 = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    return `${hours12}:${String(mins).padStart(2, '0')} ${period}`;
}

function currentTimeLabel() {
    const now = new Date();
    return formatMinutesAsTime(now.getHours() * 60 + now.getMinutes());
}

// The Time column shows the start-end range plus the selected duration.
function sessionTimeHtml(item) {
    const start = String(item.time || '').trim();
    const duration = Number(item.duration);
    const startMinutes = parseTimeToMinutes(start);
    const label = durationLabel(duration);

    if (!start) return '<span class="muted-dash">--</span>';
    if (!label || startMinutes === null) {
        return `<span class="time-pill">${start}</span>`;
    }

    const end = formatMinutesAsTime(startMinutes + duration * 60);
    return `<div class="time-cell">
        <span class="time-pill">${formatMinutesAsTime(startMinutes)} &ndash; ${end}</span>
        <span class="duration-text">${label}</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// LOGIN / REGISTER
// ---------------------------------------------------------------------------
function showTab(tab) {
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const isLogin = tab === 'login';

    if (isLogin) {
        loginForm.classList.remove('hidden');
        regForm.classList.add('hidden');
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
    } else {
        regForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
    }

    if (title) {
        title.textContent = isLogin ? 'Welcome back' : 'Create your profile';
    }
    if (subtitle) {
        subtitle.textContent = isLogin
            ? 'Select your receptionist profile to begin your shift.'
            : 'Register your name and assigned shift to get started.';
    }

    tabLogin.setAttribute('aria-selected', isLogin ? 'true' : 'false');
    tabRegister.setAttribute('aria-selected', isLogin ? 'false' : 'true');
}

async function loadReceptionists() {
    try {
        const response = await fetch('/api/receptionists');
        const result = await response.json();
        const select = document.getElementById('login-receptionist');

        // Keep the placeholder, replace the rest
        select.innerHTML = '<option value="">Select your profile</option>';

        if (result.success && result.data) {
            result.data.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.id;
                const shiftLabel = r.shift === 'morning' ? 'Morning' : 'Night';
                opt.textContent = `${r.name} \u2014 ${shiftLabel} shift`;
                select.appendChild(opt);
            });
        }
    } catch (error) {
        console.error('Error loading receptionists:', error);
    }
}

async function registerReceptionist() {
    const name = document.getElementById('reg-name').value.trim();
    const shift = document.getElementById('reg-shift').value;
    const msg = document.getElementById('reg-msg');

    if (!name) {
        msg.textContent = 'Please enter your full name.';
        msg.className = 'msg error';
        return;
    }

    try {
        const response = await fetch('/api/receptionists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, shift })
        });
        const result = await response.json();

        if (result.success) {
            msg.textContent = '';
            msg.className = 'msg';
            document.getElementById('reg-name').value = '';
            await loadReceptionists();
            showTab('login');

            const loginSelect = document.getElementById('login-receptionist');
            if (result.data && result.data.id !== undefined) {
                loginSelect.value = String(result.data.id);
            }

            const loginMsg = document.getElementById('login-msg');
            loginMsg.textContent = `Profile created for the ${shift} shift. You can start your shift now.`;
            loginMsg.className = 'msg success';
        } else {
            msg.textContent = result.error;
            msg.className = 'msg error';
        }
    } catch (error) {
        console.error('Error registering:', error);
        msg.textContent = 'Connection error.';
        msg.className = 'msg error';
    }
}

async function startShift() {
    const receptionistId = document.getElementById('login-receptionist').value;
    const msg = document.getElementById('login-msg');

    if (!receptionistId) {
        msg.textContent = 'Please select your profile first.';
        msg.className = 'msg error';
        return;
    }

    try {
        const response = await fetch('/api/sessions/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receptionist_id: receptionistId })
        });
        const result = await response.json();

        if (result.success) {
            currentSession = result.data;
            localStorage.setItem('shift_session', JSON.stringify(currentSession));
            enterApp();
        } else {
            msg.textContent = result.error;
            msg.className = 'msg error';
        }
    } catch (error) {
        console.error('Error starting shift:', error);
        msg.textContent = 'Connection error.';
        msg.className = 'msg error';
    }
}

async function logout() {
    if (!currentSession) return;

    closeProfileMenu();

    const isNight = currentSession.shift === 'night';
    const confirmMsg = isNight
        ? 'Logging out as NIGHT shift will CLOSE the day and save all sales into Monthly Sales Data. Continue?'
        : 'End your morning shift? The day stays open for the night receptionist.';

    if (!confirm(confirmMsg)) return;

    try {
        const response = await fetch('/api/sessions/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: currentSession.id })
        });
        const result = await response.json();

        if (result.success) {
            if (isNight) {
                alert(`Day closed. ${result.archived} record(s) saved into Weekly & Monthly Sales Data.`);
            }
            currentSession = null;
            localStorage.removeItem('shift_session');
            showApp(false);
            loadReceptionists();

            const loginMsg = document.getElementById('login-msg');
            loginMsg.textContent = '';
            loginMsg.className = 'msg';
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        console.error('Error ending session:', error);
        alert('Connection error.');
    }
}

// ---------------------------------------------------------------------------
// RECEPTION PROFILE MENU
// ---------------------------------------------------------------------------
function profileInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '--';
    return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('');
}

function toggleProfileMenu() {
    const dropdown = document.getElementById('profile-dropdown');
    const button = document.getElementById('profile-btn');
    if (!dropdown || !button) return;

    const hidden = dropdown.classList.toggle('hidden');
    button.setAttribute('aria-expanded', hidden ? 'false' : 'true');

    if (!hidden) loadProfile();
}

function closeProfileMenu() {
    const dropdown = document.getElementById('profile-dropdown');
    const button = document.getElementById('profile-btn');
    if (dropdown) dropdown.classList.add('hidden');
    if (button) button.setAttribute('aria-expanded', 'false');
}

function renderProfile() {
    if (!currentSession) return;

    const name = currentSession.receptionist_name || '--';
    const shift = String(currentSession.shift || '').toLowerCase();
    const shiftLabel = shift
        ? shift.charAt(0).toUpperCase() + shift.slice(1) + ' Shift'
        : '--';
    const avatarText = profileInitials(name);

    const smallAvatar = document.getElementById('profile-avatar');
    const largeAvatar = document.getElementById('profile-avatar-lg');
    smallAvatar.textContent = avatarText;
    largeAvatar.textContent = avatarText;
    smallAvatar.className = 'profile-avatar ' + shift;
    largeAvatar.className = 'profile-avatar profile-avatar-lg ' + shift;

    document.getElementById('receptionist-name').textContent = name;
    document.getElementById('profile-name-lg').textContent = name;
    document.getElementById('profile-shift-lg').textContent = shiftLabel;

    const badge = document.getElementById('shift-badge');
    badge.textContent = shift ? shift.toUpperCase() + ' SHIFT' : '--';
    badge.className = 'shift-badge ' + shift;

    // Stats are refreshed each time the menu opens.
    document.getElementById('profile-member-since').textContent = '\u2014';
    document.getElementById('profile-shift-count').textContent = '\u2014';
    document.getElementById('profile-sales-count').textContent = '\u2014';
}

async function loadProfile() {
    if (!currentSession || !currentSession.receptionist_id) return;

    try {
        const response = await fetch(`/api/receptionists/${currentSession.receptionist_id}`);
        const result = await response.json();
        if (!result.success || !result.data) return;

        const profile = result.data;
        document.getElementById('profile-member-since').textContent =
            formatProfileDate(profile.created_at);
        document.getElementById('profile-shift-count').textContent =
            Number(profile.shifts_worked) || 0;
        document.getElementById('profile-sales-count').textContent =
            Number(profile.records_logged) || 0;
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

function formatProfileDate(value) {
    if (!value) return '\u2014';
    const iso = String(value).slice(0, 10);
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// ---------------------------------------------------------------------------
// DELETE OWN ACCOUNT
// ---------------------------------------------------------------------------
function openDeleteAccount() {
    if (!currentSession) return;

    closeProfileMenu();

    const overlay = document.getElementById('delete-account-overlay');
    const input = document.getElementById('delete-confirm-name');
    const message = document.getElementById('delete-account-msg');
    const button = document.getElementById('delete-account-btn');

    input.value = '';
    input.placeholder = `Type "${currentSession.receptionist_name}"`;
    message.textContent = '';
    message.className = 'msg';
    button.textContent = 'Delete My Account';
    button.disabled = true;

    overlay.classList.remove('hidden');
    input.focus();
}

function updateDeleteState() {
    if (!currentSession) return;

    const typed = document.getElementById('delete-confirm-name').value.trim().toLowerCase();
    const expected = String(currentSession.receptionist_name || '').trim().toLowerCase();
    document.getElementById('delete-account-btn').disabled = !expected || typed !== expected;
}

function closeDeleteAccount() {
    const overlay = document.getElementById('delete-account-overlay');
    if (overlay) overlay.classList.add('hidden');
}

async function deleteMyAccount() {
    if (!currentSession) return;

    const button = document.getElementById('delete-account-btn');
    const message = document.getElementById('delete-account-msg');
    const typed = document.getElementById('delete-confirm-name').value.trim();
    const expected = String(currentSession.receptionist_name || '').trim();

    if (typed.toLowerCase() !== expected.toLowerCase()) {
        message.textContent = 'The name does not match.';
        message.className = 'msg error';
        return;
    }

    button.disabled = true;
    button.textContent = 'Deleting...';

    try {
        const response = await fetch(`/api/receptionists/${currentSession.receptionist_id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSession.id,
                confirm_name: typed
            })
        });
        const result = await response.json();

        if (!result.success) {
            message.textContent = result.error || 'Could not delete your account.';
            message.className = 'msg error';
            button.disabled = false;
            button.textContent = 'Delete My Account';
            return;
        }

        const deletedName = expected;
        closeDeleteAccount();
        currentSession = null;
        localStorage.removeItem('shift_session');
        showApp(false);
        showTab('login');
        await loadReceptionists();

        const loginMsg = document.getElementById('login-msg');
        loginMsg.textContent = `${deletedName}'s account was deleted. You can register a new profile.`;
        loginMsg.className = 'msg success';

        // Reset the profile chip for the next login.
        document.getElementById('receptionist-name').textContent = '--';
        document.getElementById('profile-avatar').textContent = '--';
        document.getElementById('profile-avatar').className = 'profile-avatar';
        document.getElementById('shift-badge').textContent = '--';
        document.getElementById('shift-badge').className = 'shift-badge';

        button.textContent = 'Delete My Account';
        button.disabled = true;
    } catch (error) {
        console.error('Error deleting account:', error);
        message.textContent = 'Connection error. Please try again.';
        message.className = 'msg error';
        button.disabled = false;
        button.textContent = 'Delete My Account';
    }
}

// ---------------------------------------------------------------------------
// APP ENTRY / STATE
// ---------------------------------------------------------------------------
function enterApp() {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    closeProfileMenu();
    closeDeleteAccount();
    cancelEdit();
    if (currentSession) renderProfile();

    // Coming back from logout: land on a date that can actually be edited, so
    // the shift starts on a ready-to-use input form instead of a closed day.
    fetchSalesRecords({ autoAdvance: true });
}

function showApp(loggedIn) {
    const overlay = document.getElementById('login-overlay');
    const app = document.getElementById('app');
    if (loggedIn) {
        overlay.classList.add('hidden');
        app.classList.remove('hidden');
    } else {
        overlay.classList.remove('hidden');
        app.classList.add('hidden');
    }
}

function onDateChange() {
    cancelEdit();
    fetchSalesRecords();
}

// ---------------------------------------------------------------------------
// SALES DATA
// ---------------------------------------------------------------------------
async function fetchSalesRecords(opts) {
    const options = opts || {};
    const date = document.getElementById('report-date').value;
    try {
        const response = await fetch('/api/sales' + (date ? `?date=${date}` : ''));
        const result = await response.json();
        if (result.success) {
            salesData = result.data;
            dayClosedOnServer = !!result.closed;
            renderTable();

            // Login entry point only: if this date is already closed, step
            // forward to the first open day so the form is ready for input.
            if (options.autoAdvance && dayClosed) {
                await advanceToOpenDay();
            }
        } else {
            console.error('Failed to load data:', result.error);
        }
    } catch (error) {
        console.error('Error connecting to backend:', error);
    }
}

// Advance the date picker to the next date whose day is not closed.
// Only used right after login - browsing a closed day manually is still allowed.
async function advanceToOpenDay() {
    const picker = document.getElementById('report-date');
    let candidate = picker.value;

    for (let i = 0; i < 365 && candidate; i++) {
        candidate = addDays(candidate, 1);
        if (!(await isDateClosed(candidate))) {
            picker.value = candidate;
            await fetchSalesRecords(); // no further auto-advance
            return;
        }
    }
}

async function isDateClosed(date) {
    try {
        const response = await fetch('/api/sales?date=' + date);
        const result = await response.json();
        return !!(result.success && result.closed);
    } catch (error) {
        return false;
    }
}

// YYYY-MM-DD plus n days (UTC-safe, no timezone drift)
function addDays(iso, n) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function renderTable() {
    const tbody = document.getElementById('sales-tbody');
    tbody.innerHTML = '';

    let grandTotalSales = 0;
    let grandTotalComm = 0;
    let grandTotalCash = 0;
    let grandTotalEpay = 0;

    // The day is read-only when the server confirms the date is archived, or
    // when every record on screen is archived. The server flag also covers a
    // day that was closed with zero sales.
    dayClosed = dayClosedOnServer ||
        (salesData.length > 0 && salesData.every(item => item.archived));

    salesData.forEach((item) => {
        const totalNum = Number(item.total) || 0;
        const commNum = Number(item.comm) || 0;
        const paymentMethod = String(item.payment_method || 'cash').toLowerCase() === 'epay'
            ? 'epay'
            : 'cash';
        const paymentLabel = paymentMethod === 'epay' ? 'E-Pay' : 'Cash';

        grandTotalSales += totalNum;
        grandTotalComm += commNum;

        if (paymentMethod === 'epay') {
            grandTotalEpay += totalNum;
        } else {
            grandTotalCash += totalNum;
        }

        const archived = !!item.archived;
        const readOnly = archived || dayClosed;
        const tr = document.createElement('tr');
        if (archived) tr.classList.add('row-archived');

        const loggedBy = item.receptionist
            ? `<span class="tag ${item.shift || ''}">${item.shift || ''} &middot; ${item.receptionist}</span>`
            : '<span class="muted-dash">--</span>';

        const actionCell = readOnly
            ? `<span class="lock" title="${archived ? 'Archived' : 'Day closed'} (read-only)">&#128274;</span>`
            : `<div class="row-actions">
                   <button class="btn-edit" onclick="startEdit(${item.id})" title="Edit record">Edit</button>
                   <button class="btn-danger" onclick="deleteRow(${item.id})" title="Delete">&times;</button>
               </div>`;

        tr.innerHTML = `
            <td><strong>${item.name}</strong></td>
            <td>${item.service || 'N/A'}</td>
            <td>Room ${item.room || '--'}</td>
            <td>${sessionTimeHtml(item)}</td>
            <td>${PESO}${totalNum.toFixed(2)}</td>
            <td><span class="pay-badge ${paymentMethod}">${paymentLabel}</span></td>
            <td>${PESO}${commNum.toFixed(2)}</td>
            <td>${loggedBy}</td>
            <td>${actionCell}</td>
        `;
        tbody.appendChild(tr);
    });

    const netRevenue = grandTotalSales - grandTotalComm;

    document.getElementById('foot-total-sales').innerText = `${PESO}${grandTotalSales.toFixed(2)}`;
    document.getElementById('foot-epay-total').innerText = `${PESO}${grandTotalEpay.toFixed(2)}`;
    document.getElementById('foot-total-comm').innerText = `${PESO}${grandTotalComm.toFixed(2)}`;

    document.getElementById('total-sales-card').innerText = `${PESO}${grandTotalSales.toFixed(2)}`;
    document.getElementById('epay-total-card').innerText = `${PESO}${grandTotalEpay.toFixed(2)}`;
    document.getElementById('cash-total-card').innerText = `${PESO}${grandTotalCash.toFixed(2)}`;
    document.getElementById('total-comm-card').innerText = `${PESO}${grandTotalComm.toFixed(2)}`;
    document.getElementById('net-revenue-card').innerText = `${PESO}${netRevenue.toFixed(2)}`;
    document.getElementById('total-count-card').innerText = salesData.length;

    updateFormState();
}

// Disable the add form + show banner when the day is closed
function updateFormState() {
    const container = document.getElementById('add-form-container');
    const banner = document.getElementById('closed-banner');
    const closeBtn = document.getElementById('close-day-btn');

    // If the day became read-only while a record was being edited, drop the
    // edit so the locked form is not left holding unsaved values.
    if (dayClosed && editingSaleId !== null) cancelEdit();

    if (dayClosed) {
        container.classList.add('form-disabled');
        banner.classList.remove('hidden');
        closeBtn.classList.add('hidden');
    } else {
        container.classList.remove('form-disabled');
        banner.classList.add('hidden');
        closeBtn.classList.remove('hidden');
    }
}

// Manual override: close & archive the viewed day (e.g. if no night shift comes in)
async function closeDay() {
    const date = document.getElementById('report-date').value;
    if (!date) {
        alert('Please choose a date to close.');
        return;
    }

    if (!confirm(`Save ALL sales for ${date} into Weekly & Monthly Sales Data?\n\nThey will become read-only.`)) {
        return;
    }

    try {
        const response = await fetch('/api/sales/archive-day', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date })
        });
        const result = await response.json();

        if (result.success) {
            alert(`Saved. ${result.archived} record(s) moved into Weekly & Monthly Sales Data.`);
            fetchSalesRecords(); // refresh; will mark the day read-only
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        console.error('Error archiving day:', error);
        alert('Connection error.');
    }
}

// ---------------------------------------------------------------------------
// ADD / EDIT FORM
// ---------------------------------------------------------------------------
function clearSaleForm() {
    document.getElementById('new-name').value = '';
    document.getElementById('new-service').value = '';
    document.getElementById('new-room').value = '';
    document.getElementById('new-duration').value = '1';
    document.getElementById('new-total').value = '';
    document.getElementById('new-comm').value = '';
    document.getElementById('new-payment-method').value = 'cash';
    editingStartTime = '';
}

function setSaleFormMode(mode, recordId) {
    const editing = mode === 'edit';
    editingSaleId = editing ? recordId : null;

    document.getElementById('form-title').textContent = editing
        ? `Edit Sales Record #${recordId}`
        : '+ Add New Sales Record';
    document.getElementById('add-record-btn').textContent = editing
        ? 'Update Record'
        : 'Add Record';
    document.getElementById('cancel-edit-btn').classList.toggle('hidden', !editing);
    document.getElementById('add-form-container').classList.toggle('editing', editing);
}

function startEdit(id) {
    if (dayClosed) {
        alert('This day is closed and read-only. Records cannot be edited.');
        return;
    }

    const item = salesData.find(row => String(row.id) === String(id));
    if (!item) {
        alert('Record not found. Please refresh the page.');
        return;
    }
    if (item.archived) {
        alert('This record is archived and read-only.');
        return;
    }

    document.getElementById('new-name').value = item.name || '';
    document.getElementById('new-service').value = item.service || '';
    document.getElementById('new-room').value = item.room || '';
    const duration = Number(item.duration);
    document.getElementById('new-duration').value =
        duration === 1 || duration === 1.5 || duration === 2 ? String(duration) : '1';
    document.getElementById('new-total').value = item.total != null ? item.total : '';
    document.getElementById('new-comm').value = item.comm != null ? item.comm : '';
    document.getElementById('new-payment-method').value =
        String(item.payment_method || 'cash').toLowerCase() === 'epay' ? 'epay' : 'cash';
    editingStartTime = item.time || '';

    setSaleFormMode('edit', item.id);

    const container = document.getElementById('add-form-container');
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('new-name').focus({ preventScroll: true });
}

function cancelEdit() {
    setSaleFormMode('add');
    clearSaleForm();
}

async function addEntry() {
    if (dayClosed) {
        alert('This day is archived and read-only. Records cannot be changed.');
        return;
    }

    const isEditing = editingSaleId !== null;
    const name = document.getElementById('new-name').value.trim();
    const service = document.getElementById('new-service').value.trim();
    const room = document.getElementById('new-room').value;
    const timeInput = document.getElementById('new-time');
    const enteredTime = timeInput ? timeInput.value.trim() : '';
    const time = enteredTime
        || (isEditing ? editingStartTime : currentTimeLabel());
    const duration = document.getElementById('new-duration').value;
    const total = parseFloat(document.getElementById('new-total').value) || 0;
    const comm = parseFloat(document.getElementById('new-comm').value) || 0;
    const payment_method = document.getElementById('new-payment-method').value;
    const report_date = document.getElementById('report-date').value;

    if (!name) {
        alert('Please enter a staff/therapist name.');
        return;
    }

    const payload = {
        name, service, room, time, duration, total, comm, payment_method, report_date,
        receptionist: currentSession ? currentSession.receptionist_name : '',
        shift: currentSession ? currentSession.shift : ''
    };

    try {
        const response = await fetch(
            isEditing ? `/api/sales/${editingSaleId}` : '/api/sales',
            {
                method: isEditing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        const result = await response.json();
        if (result.success) {
            if (isEditing) {
                salesData = salesData.map(item =>
                    String(item.id) === String(result.data.id) ? result.data : item
                );
            } else {
                salesData.push(result.data);
            }
            renderTable();
            cancelEdit();
        } else {
            alert(`Error ${isEditing ? 'updating' : 'adding'} record: ` + result.error);
            // The day may have been closed from another device - resync.
            fetchSalesRecords();
        }
    } catch (error) {
        console.error(`Error ${isEditing ? 'updating' : 'adding'} record:`, error);
        alert('Connection error. Please try again.');
    }
}

async function deleteRow(id) {
    if (dayClosed) {
        alert('This day is closed and read-only. Records cannot be deleted.');
        return;
    }

    if (!confirm('Are you sure you want to delete this record?')) return;

    try {
        const response = await fetch(`/api/sales/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            if (editingSaleId !== null && String(editingSaleId) === String(id)) {
                cancelEdit();
            }
            salesData = salesData.filter(item => item.id != id);
            renderTable();
        } else {
            alert('Error deleting record: ' + result.error);
        }
    } catch (error) {
        console.error('Error deleting record:', error);
    }
}

function exportCSV() {
    let csvContent = 'data:text/csv;charset=utf-8,Name,Service,Room,Time,Total Sales,Payment Method,Commission,Logged By,Shift\n';
    salesData.forEach(row => {
        const payment = String(row.payment_method || 'cash').toLowerCase() === 'epay'
            ? 'E-Pay'
            : 'Cash';
        csvContent += `"${row.name}","${row.service}","Room ${row.room}","${row.time}",${row.total},"${payment}",${row.comm},"${row.receptionist || ''}","${row.shift || ''}"\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Daily_Sales_Report_${document.getElementById('report-date').value}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ---------------------------------------------------------------------------
// INIT: restore session if one is still active
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    loadReceptionists();

    // Clicking outside the profile menu closes it; Escape closes any overlay.
    document.addEventListener('click', (event) => {
        const menu = document.getElementById('profile-menu');
        if (menu && !menu.contains(event.target)) closeProfileMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeProfileMenu();
            closeDeleteAccount();
        }
    });

    const deleteOverlay = document.getElementById('delete-account-overlay');
    deleteOverlay.addEventListener('click', (event) => {
        if (event.target === deleteOverlay) closeDeleteAccount();
    });

    try {
        const response = await fetch('/api/sessions/active');
        const result = await response.json();
        if (result.success && result.data) {
            currentSession = {
                id: result.data.id,
                receptionist_id: result.data.receptionist_id,
                receptionist_name: result.data.receptionist_name,
                shift: result.data.shift
            };
            localStorage.setItem('shift_session', JSON.stringify(currentSession));
            enterApp();
            return;
        }
    } catch (error) {
        console.error('Error checking active session:', error);
    }

    // No active session -> show login overlay
    localStorage.removeItem('shift_session');
    showApp(false);
});
