// Temporary diagnostic: checks which role the SUPABASE_KEY maps to and
// whether the RLS policies from shema.sql exist on the LIVE database.
// Run with:  node check-rls.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
    console.error('MISSING: SUPABASE_URL or SUPABASE_KEY in .env');
    process.exit(1);
}

// 1. Which project + which role does the key use?
console.log('Project (from SUPABASE_URL):', url.replace(/^https?:\/\//, ''));
try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString());
    console.log('Key role (JWT claim)   :', payload.role);
    console.log('Key issued to (ref)    :', payload.ref || '(n/a)');
} catch (e) {
    console.log('(key is not a classic JWT - likely a new publishable key, role = anon)');
}

const supabase = createClient(url, key);

(async () => {
    // 2. Can we read the table? (tests SELECT policy USING)
    const { data: rows, error: selErr } = await supabase
        .from('receptionists').select('id').limit(1);
    console.log('\nSELECT receptionists   :', selErr ? 'FAILED -> ' + selErr.message : 'OK (row visible/empty)');

    // 3. Does an INSERT pass the WITH CHECK? (insert + immediate rollback via delete)
    const probe = '__rls_probe__' + Date.now();
    const { error: insErr } = await supabase
        .from('receptionists')
        .insert([{ name: probe, shift: 'morning' }]);
    console.log('INSERT receptionists  :', insErr ? 'FAILED -> ' + insErr.message : 'OK');

    if (!insErr) {
        await supabase.from('receptionists').delete().eq('name', probe);
        console.log('  (probe row cleaned up)');
    }

    // 4. Ask the database directly which policies exist (needs an rpc; best-effort)
    const { data: pol, error: polErr } = await supabase.rpc('list_rls_policies');
    if (polErr) {
        console.log('\nPolicies table        : not readable via API (expected).');
        console.log('=> Apply shema.sql in the Supabase SQL Editor to create them.');
    } else {
        console.log('\nPolicies on server    :', pol);
    }
})();
