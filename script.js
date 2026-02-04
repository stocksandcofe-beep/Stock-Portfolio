const PERF_CSV = 'https://raw.githubusercontent.com/stocksandcofe-beep/Stock-Portfolio/main/Performance.csv';
const HOLD_CSV = 'https://raw.githubusercontent.com/stocksandcofe-beep/Stock-Portfolio/main/Holdings.csv';
const LIVE_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSSXM1dYBxznBus1fR27mZ9AEfISwr54qMJHTsw6cSyPs7LAwV1sw6Y8zpC7V3gwCcH854_HudCUPEm/pub?gid=0&single=true&output=csv';

let chartInstance, rawPerfData = [], currentHoldingsData = [], livePriceMap = {}, currentPeriod = 'all', currentChartMode = 'growth', totalValLatest = 0;

function cleanNum(val) { return parseFloat(val?.toString().replace(/[^0-9.-]+/g, "")) || 0; }
function parseDate(dStr) { const p = dStr.split('/'); return new Date(p[2], p[0]-1, p[1]); }
function getCol(row, keys) {
    const rKeys = Object.keys(row);
    for (let k of keys) { 
        const f = rKeys.find(rk => rk.toLowerCase().trim() === k.toLowerCase().trim());
        if (f) return row[f];
    }
    return null;
}

window.onload = () => {
    Papa.parse(PERF_CSV, {
        download: true, header: false, skipEmptyLines: true,
        complete: function(results) {
            rawPerfData = results.data.slice(1).filter(r => r[0] && r[47]);
            initDashboard();
            fetchLivePrices(true);
        }
    });
};

function fetchLivePrices(isInitial = false) {
    Papa.parse(LIVE_CSV, {
        download: true, header: false, skipEmptyLines: true,
        complete: function(results) {
            results.data.forEach(row => {
                const ticker = row[0]?.toUpperCase().trim();
                if (ticker) livePriceMap[ticker] = { price: cleanNum(row[1]), rate: cleanNum(row[2]) || 1.0 };
            });
            if(!isInitial) fetchHoldings();
        }
    });
}

function refreshLivePrices() { fetchLivePrices(false); }

function showPage(pageId) {
    document.getElementById('page-dashboard').classList.toggle('hidden', pageId !== 'dashboard');
    document.getElementById('page-holdings').classList.toggle('hidden', pageId !== 'holdings');
    document.getElementById('nav-dash').classList.toggle('active', pageId === 'dashboard');
    document.getElementById('nav-holdings').classList.toggle('active', pageId === 'holdings');
    if(pageId === 'holdings') fetchHoldings();
}

function updatePeriod(p) {
    currentPeriod = p;
    ['all', 'ytd', '1y', 'ly'].forEach(id => document.getElementById('p-'+id).classList.toggle('active', id === p));
    initDashboard();
}

function updateChartMode(m) {
    currentChartMode = m;
    document.getElementById('btn-growth').classList.toggle('active', m === 'growth');
    document.getElementById('btn-profit').classList.toggle('active', m === 'profit');
    initDashboard();
}

function initDashboard() {
    if (!rawPerfData.length) return;
    const latestDataRow = rawPerfData[rawPerfData.length - 1];
    const latestDateInFullSet = parseDate(latestDataRow[0]);

    const filtered = rawPerfData.filter(r => {
        const d = parseDate(r[0]);
        if (currentPeriod === 'ytd') return d.getFullYear() === latestDateInFullSet.getFullYear();
        if (currentPeriod === '1y') return d >= new Date().setFullYear(latestDateInFullSet.getFullYear() - 1);
        if (currentPeriod === 'ly') return d.getFullYear() === latestDateInFullSet.getFullYear() - 1;
        return true;
    });

    if (!filtered.length) return;
    const start = filtered[0];
    const end = filtered[filtered.length - 1];
    
    const valEnd = cleanNum(end[47]);
    totalValLatest = valEnd;

    const pProfit = cleanNum(end[51]) - cleanNum(start[51]);
    const pDep = cleanNum(end[50]) - cleanNum(start[50]);
    const baseValue = cleanNum(start[47]) + pDep;
    const periodReturnPerc = baseValue !== 0 ? (pProfit / baseValue) * 100 : 0;

    document.getElementById('hero-val').innerText = '£' + valEnd.toLocaleString(undefined, {maximumFractionDigits: 0});
    document.getElementById('date-label').innerText = start[0] + ' — ' + end[0];

    let displayPerc = (currentPeriod === 'all') ? 
        ( (valEnd - (valEnd - cleanNum(end[51]))) / (valEnd - cleanNum(end[51])) * 100 ) : periodReturnPerc;

    const trVal = document.getElementById('stat-total-return');
    trVal.innerText = (displayPerc < 0 ? '-' : '') + Math.abs(displayPerc).toFixed(2) + '%';
    trVal.className = `text-2xl font-bold ${displayPerc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const npVal = document.getElementById('stat-profit');
    npVal.innerText = (pProfit < 0 ? '-' : '+') + '£' + Math.abs(pProfit).toLocaleString(undefined, {maximumFractionDigits: 0});
    npVal.className = `text-2xl font-bold ${pProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const badge = document.getElementById('hero-badge');
    badge.innerText = (displayPerc >= 0 ? '↑ ' : '↓ ') + Math.abs(displayPerc).toFixed(2) + '%';
    badge.className = displayPerc >= 0 ? 'badge-up' : 'badge-down';
    badge.classList.remove('hidden');

    renderChart(filtered);
}

function renderChart(data) {
    const ctx = document.getElementById('mainChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const isGrowth = currentChartMode === 'growth';
    const spyStart = cleanNum(data[0][52]);
    const portStart = isGrowth ? cleanNum(data[0][47]) : cleanNum(data[0][51]);
    const spyData = data.map(r => (spyStart !== 0 ? (cleanNum(r[52]) / spyStart) * portStart : 0));

    const datasets = [{
        label: 'Portfolio',
        data: data.map(r => isGrowth ? cleanNum(r[47]) : cleanNum(r[51])),
        borderColor: isGrowth ? '#10b981' : '#3b82f6',
        borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
        backgroundColor: 'rgba(16, 185, 129, 0.05)'
    }];

    if (isGrowth) {
        datasets.push({
            label: 'Benchmark',
            data: spyData,
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false
        });
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(r => parseDate(r[0])),
            datasets: datasets
        },
        options: { 
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { position: 'right', ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.03)' } },
                x: { 
                    ticks: { 
                        color: '#71717a', font: { size: 10 }, maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 10, // Keeps X-axis from crowding
                        callback: function(val, index) {
                            const date = this.getLabelForValue(val);
                            if (currentPeriod === 'all') {
                                return date.toLocaleString('default', { month: 'short', year: '2-digit' });
                            }
                            return date.toLocaleString('default', { month: 'short' });
                        }
                    }, 
                    grid: { display: false } 
                }
            }
        }
    });
}

function fetchHoldings() {
    Papa.parse(HOLD_CSV, { download: true, header: true, skipEmptyLines: true, complete: res => {
        currentHoldingsData = res.data.filter(r => getCol(r, ['Ticker']) && cleanNum(getCol(r, ['Shares'])) > 0);
        displayHoldings(currentHoldingsData);
    }});
}

function displayHoldings(data) {
    const tbody = document.getElementById('holdings-table-body');
    tbody.innerHTML = '';
    data.forEach(row => {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const curValueGBP = (cleanNum(getCol(row, ['Shares'])) * (livePriceMap[ticker]?.price || cleanNum(getCol(row, ['Current Price'])))) * (livePriceMap[ticker]?.rate || 1.0);
        const weight = totalValLatest > 0 ? (curValueGBP / totalValLatest) * 100 : 0;
        
        tbody.innerHTML += `
            <tr class="hover:bg-white/5 transition border-b border-zinc-800/50 text-sm">
                <td class="p-4"><div class="font-bold text-white">${getCol(row, ['Company'])}</div></td>
                <td class="p-4 text-right">£${curValueGBP.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td class="p-4 text-right">${weight.toFixed(1)}%</td>
            </tr>`;
    });
}
