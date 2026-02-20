const PERF_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqzdML5fedLHG5w8t24X3PJTD-CA_Wg2_Jumz3kOQ-pL6uZCMjirW6RH2wVwd_BZyRnCzZYf0RFOGD/pub?gid=0&single=true&output=csv';
const HOLD_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRBdW0eqX7wJilgANW92D9MXqElTdcSYFzLHHS_lyr0Hiw41Kt2ItdRh4eOMgpsZG95h5yoatM6xYKU/pub?gid=0&single=true&output=csv';
const LIVE_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSSXM1dYBxznBus1fR27mZ9AEfISwr54qMJHTsw6cSyPs7LAwV1sw6Y8zpC7V3gwCcH854_HudCUPEm/pub?gid=0&single=true&output=csv';

let chartInstance, rawPerfData = [], currentHoldingsData = [], livePriceMap = {}, currentPeriod = 'all', currentChartMode = 'growth', totalValLatest = 0;
let sortKey = '', sortDir = 1;

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

Papa.parse(PERF_CSV, {
    download: true, header: false, skipEmptyLines: true,
    complete: function(results) {
        rawPerfData = results.data.slice(1).filter(r => r[0] && r[47]);
        initDashboard();
        fetchLivePrices(true);
    }
});

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
    const valStart = cleanNum(start[47]);
    totalValLatest = valEnd;

    const pProfit = cleanNum(end[51]) - cleanNum(start[51]);
    const pDep = cleanNum(end[50]) - cleanNum(start[50]);
    const baseValue = valStart + pDep;
    const periodReturnPerc = baseValue !== 0 ? (pProfit / baseValue) * 100 : 0;

    document.getElementById('hero-val').innerText = '£' + valEnd.toLocaleString(undefined, {maximumFractionDigits: 0});
    document.getElementById('date-label').innerText = start[0] + ' — ' + end[0];

    let displayPerc;
    if (currentPeriod === 'all') {
        const totalProfit = cleanNum(end[51]);
        const costBasis = valEnd - totalProfit;
        displayPerc = costBasis !== 0 ? (totalProfit / costBasis) * 100 : 0;
    } else {
        displayPerc = periodReturnPerc;
    }

    const trVal = document.getElementById('stat-total-return');
    trVal.innerText = (displayPerc < 0 ? '-' : '') + Math.abs(displayPerc).toFixed(2) + '%';
    trVal.parentElement.className = `card p-6 border-l-4 ${displayPerc >= 0 ? 'border-emerald-500' : 'border-rose-500'}`;
    trVal.className = `text-2xl font-bold ${displayPerc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const npVal = document.getElementById('stat-profit');
    npVal.innerText = (pProfit < 0 ? '-' : '+') + '£' + Math.abs(pProfit).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0});
    npVal.parentElement.className = `card p-6 border-l-4 ${pProfit >= 0 ? 'border-emerald-500' : 'border-rose-500'}`;
    npVal.className = `text-2xl font-bold ${pProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const badge = document.getElementById('hero-badge');
    badge.innerText = (displayPerc >= 0 ? '↑ ' : '↓ ') + Math.abs(displayPerc).toFixed(2) + '%';
    badge.className = displayPerc >= 0 ? 'badge-up' : 'badge-down';
    badge.classList.remove('hidden');

    calculateMetrics(filtered);
    renderChart(filtered);
}

function calculateMetrics(data) {
    let cumFactor = 1, dailyRets = [], spyRets = [], peak = cleanNum(data[0][47]), maxDD = 0;
    for (let i = 1; i < data.length; i++) {
        const prevVal = cleanNum(data[i-1][47]), currVal = cleanNum(data[i][47]), flow = cleanNum(data[i][50]) - cleanNum(data[i-1][50]);
        const denom = prevVal + flow;
        if (denom > 0) { const r = (currVal / denom) - 1; cumFactor *= (1 + r); dailyRets.push(r); }
        const spyPrev = cleanNum(data[i-1][52]), spyCurr = cleanNum(data[i][52]);
        if(spyPrev > 0) spyRets.push((spyCurr/spyPrev)-1);
        if (currVal > peak) peak = currVal;
        const dd = peak !== 0 ? (currVal - peak) / peak : 0;
        if (dd < maxDD) maxDD = dd;
    }
    document.getElementById('stat-max-dd').innerText = Math.abs(maxDD * 100).toFixed(2) + '%';
    const twrVal = (cumFactor - 1) * 100;
    document.getElementById('stat-twr').innerText = Math.abs(twrVal).toFixed(2) + '%';
    if(dailyRets.length > 1) {
        const mean = dailyRets.reduce((a,b)=>a+b,0)/dailyRets.length;
        const sd = Math.sqrt(dailyRets.map(x=>Math.pow(x-mean,2)).reduce((a,b)=>a+b,0)/dailyRets.length);
        document.getElementById('stat-sharpe').innerText = (sd > 0) ? (((mean * 252) - 0.04) / (sd * Math.sqrt(252))).toFixed(2) : "0.00";
        const mMean = spyRets.reduce((a,b)=>a+b,0)/spyRets.length;
        let num = 0, den = 0;
        for(let i=0; i<dailyRets.length; i++) { num += (dailyRets[i]-mean)*(spyRets[i]-mMean); den += Math.pow(spyRets[i]-mMean, 2); }
        document.getElementById('stat-beta').innerText = (den !== 0) ? (num/den).toFixed(2) : "0.00";
    }
}

function renderChart(data) {
    const ctx = document.getElementById('mainChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(r => parseDate(r[0])),
            datasets: [{
                data: data.map(r => currentChartMode === 'growth' ? cleanNum(r[47]) : cleanNum(r[51])),
                borderColor: currentChartMode === 'growth' ? '#10b981' : '#3b82f6',
                borderWidth: 2, pointRadius: 0, tension: 0.4, cubicInterpolationMode: 'monotone', fill: true,
                backgroundColor: currentChartMode === 'growth' ? 'rgba(16,185,129,0.05)' : 'rgba(59,130,246,0.05)'
            }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { display: false },
                tooltip: {
                    displayColors: false, padding: 10, bodySpacing: 5,
                    callbacks: {
                        title: context => data[context[0].dataIndex][0],
                        label: context => new Intl.NumberFormat('en-GB', { 
                            style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 
                        }).format(context.parsed.y)
                    }
                }
            },
            scales: {
                y: { position: 'right', ticks: { color: '#71717a', font: { size: 10 }, callback: v => '£' + (v / 1000).toFixed(0) + 'k' }, grid: { color: 'rgba(255,255,255,0.03)' } },
                x: { 
    ticks: { 
        color: '#71717a', 
        font: { size: 10 }, 
        autoSkip: true,
        maxTicksLimit: 8,
        callback: function(val, index) {
            const date = this.getLabelForValue(val);
            
            if (currentPeriod === 'all') {
                // Since Inception: "2024 Jun"
                return date.getFullYear() + ' ' + date.toLocaleString('default', { month: 'short' });
            } else if (currentPeriod === 'ytd') {
                // YTD: "01 Jan" (Shows specific days to avoid repeating "Jan")
                return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
            }
            // 1Y / Last Year: "Jun"
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

function sortHoldings(key) {
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
    currentHoldingsData.sort((a, b) => {
        let valA = getCol(a, [key]), valB = getCol(b, [key]);
        if (key !== 'Company') { valA = cleanNum(valA); valB = cleanNum(valB); }
        return valA > valB ? sortDir : valA < valB ? -sortDir : 0;
    });
    displayHoldings(currentHoldingsData);
}

function displayHoldings(data) {
    const tbody = document.getElementById('holdings-table-body');
    tbody.innerHTML = '';
    data.forEach(row => {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const shares = cleanNum(getCol(row, ['Shares']));
        const bepLocal = cleanNum(getCol(row, ['BEP Price']));
        const liveData = livePriceMap[ticker];
        const activePriceLocal = liveData ? liveData.price : cleanNum(getCol(row, ['Current Price']));
        const activeRate = liveData ? liveData.rate : 1.0;
        const costGBP = cleanNum(getCol(row, ['Current Value'])) - cleanNum(getCol(row, ['Total Unrealised P/L'])); 
        const curValueGBP = (shares * activePriceLocal) * activeRate;
        const profitGBP = curValueGBP - costGBP;
        const percReturn = costGBP !== 0 ? ((curValueGBP / costGBP) - 1) * 100 : 0;
        const weight = totalValLatest > 0 ? (curValueGBP / totalValLatest) * 100 : 0;
        let sym = (ticker === 'WKL') ? '€' : (ticker === 'UL' ? '£' : '$');
        
        tbody.innerHTML += `<tr class="hover:bg-white/5 transition border-b border-zinc-800/50 text-sm">
    <td class="p-4 text-left" style="background: linear-gradient(90deg, rgba(16, 185, 129, 0.1) ${weight}%, transparent ${weight}%);">
        <div class="font-bold text-white">${getCol(row, ['Company'])}</div>
        <div class="text-[10px] text-zinc-500 font-mono uppercase">${ticker}</div>
    </td>
    <td class="p-4 text-center font-mono text-zinc-400">${shares}</td>
    <td class="p-4 text-center text-zinc-300">${sym}${bepLocal.toFixed(2)}</td>
    <td class="p-4 text-center font-bold text-emerald-400">${liveData ? sym + activePriceLocal.toFixed(2) : '--'}</td>
    <td class="p-4 text-center text-zinc-300 hidden">${sym}${cleanNum(getCol(row, ['Current Price'])).toFixed(2)}</td>
    <td class="p-4 text-center font-medium text-white">£${curValueGBP.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
    <td class="p-4 text-center font-semibold ${profitGBP >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${profitGBP < 0 ? '-' : '+'}£${Math.abs(profitGBP).toLocaleString(undefined, {maximumFractionDigits:0})}</td>
    <td class="p-4 text-center font-bold ${percReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${percReturn < 0 ? '-' : '+'}${Math.abs(percReturn).toFixed(2)}%</td>
    <td class="p-4 text-center font-medium text-zinc-300">${weight.toFixed(1)}%</td>
</tr>`;
    });
}

// Initialize Lucide icons
lucide.createIcons();

