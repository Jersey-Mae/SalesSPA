let monthlyData = [];

const PESO = '\u20b1';

function fmtDate(iso) {
    // iso is YYYY-MM-DD
    const [y, m, d] = iso.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${d}, ${y}`;
}

async function loadMonthly() {
    const month = document.getElementById('month-picker').value;
    if (!month) return;

    try {
        const response = await fetch(`/api/monthly?month=${month}`);
        const result = await response.json();

        if (result.success) {
            monthlyData = result.data;
            renderMonthly();
        } else {
            console.error('Failed to load monthly data:', result.error);
        }
    } catch (error) {
        console.error('Error connecting to backend:', error);
    }
}

function renderMonthly() {
    const tbody = document.getElementById('monthly-tbody');
    tbody.innerHTML = '';

    // Group by report_date
    const byDate = {};
    let grandSales = 0;
    let grandEpay = 0;
    let grandComm = 0;
    let grandCount = 0;

    monthlyData.forEach(item => {
        const date = item.report_date;
        const totalNum = Number(item.total) || 0;
        const commNum = Number(item.comm) || 0;
        const isEpay = String(item.payment_method || 'cash').toLowerCase() === 'epay';

        if (!byDate[date]) {
            byDate[date] = { sales: 0, epay: 0, comm: 0, count: 0 };
        }
        byDate[date].sales += totalNum;
        if (isEpay) byDate[date].epay += totalNum;
        byDate[date].comm += commNum;
        byDate[date].count += 1;

        grandSales += totalNum;
        if (isEpay) grandEpay += totalNum;
        grandComm += commNum;
        grandCount += 1;
    });

    // Sort dates ascending
    Object.keys(byDate).sort().forEach(date => {
        const d = byDate[date];
        const net = d.sales - d.comm;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${fmtDate(date)}</strong></td>
            <td>${d.count}</td>
            <td>${PESO}${d.sales.toFixed(2)}</td>
            <td>${PESO}${d.epay.toFixed(2)}</td>
            <td>${PESO}${d.comm.toFixed(2)}</td>
            <td>${PESO}${net.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    const grandNet = grandSales - grandComm;

    document.getElementById('m-foot-count').innerText = grandCount;
    document.getElementById('m-foot-sales').innerText = `${PESO}${grandSales.toFixed(2)}`;
    document.getElementById('m-foot-epay').innerText = `${PESO}${grandEpay.toFixed(2)}`;
    document.getElementById('m-foot-comm').innerText = `${PESO}${grandComm.toFixed(2)}`;
    document.getElementById('m-foot-net').innerText = `${PESO}${grandNet.toFixed(2)}`;

    document.getElementById('m-total-sales').innerText = `${PESO}${grandSales.toFixed(2)}`;
    document.getElementById('m-epay-total').innerText = `${PESO}${grandEpay.toFixed(2)}`;
    document.getElementById('m-total-comm').innerText = `${PESO}${grandComm.toFixed(2)}`;
    document.getElementById('m-net-revenue').innerText = `${PESO}${grandNet.toFixed(2)}`;
    document.getElementById('m-total-count').innerText = grandCount;
}

function exportMonthlyCSV() {
    let csvContent = 'data:text/csv;charset=utf-8,Date,Sessions,Total Sales,E-Pay,Total Commission,Net\n';

    const byDate = {};
    monthlyData.forEach(item => {
        const date = item.report_date;
        const totalNum = Number(item.total) || 0;
        const commNum = Number(item.comm) || 0;
        const isEpay = String(item.payment_method || 'cash').toLowerCase() === 'epay';
        if (!byDate[date]) byDate[date] = { sales: 0, epay: 0, comm: 0, count: 0 };
        byDate[date].sales += totalNum;
        if (isEpay) byDate[date].epay += totalNum;
        byDate[date].comm += commNum;
        byDate[date].count += 1;
    });

    Object.keys(byDate).sort().forEach(date => {
        const d = byDate[date];
        csvContent += `${date},${d.count},${d.sales.toFixed(2)},${d.epay.toFixed(2)},${d.comm.toFixed(2)},${(d.sales - d.comm).toFixed(2)}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Monthly_Sales_${document.getElementById('month-picker').value}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

document.addEventListener('DOMContentLoaded', loadMonthly);
