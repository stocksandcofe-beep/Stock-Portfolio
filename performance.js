const PERF_CSV = 'https://raw.githubusercontent.com/stocksandcofe-beep/Stock-Portfolio/main/Performance.csv';

let chartInstance, rawPerfData = [], currentPeriod = 'all', currentChartMode = 'growth';

function cleanNum(val) { return parseFloat(val?.toString().replace(/[^0-9.-]+/g, "")) || 0; }
function parseDate(dStr) { const p = dStr.split('/'); return new Date(p[2], p[0]-1, p[1]); }

Papa.parse(PERF_CSV, {
    download: true, header: false, skipEmptyLines: true,
    complete: function(results) {
        // Filter rows that have valid date (0) and Net Value (47)
        rawPerfData = results.data.slice(1).filter(r => r[0] && r[47]);
        initDashboard();
    }
});

function updatePeriod(p) {
    currentPeriod = p;
    ['all', 'ytd', '1y', 'ly'].forEach(id => {
        const btn = document.getElementById('p-'+id);
        if(btn) btn.classList.toggle('active', id === p);
    });
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
    const latestRow = rawPerfData[rawPerfData.length - 1];
    const latestDateInFullSet = parseDate(latestRow[0]);

    const filtered = rawPerfData.filter(r => {
        const d = parseDate(r[0]);
        if (currentPeriod === 'ytd') return d.getFullYear() === latestDateInFullSet.getFullYear();
        if (currentPeriod === '1y') return d >= new Date().setFullYear(latestDateInFullSet.getFullYear() - 1);
        if (currentPeriod === 'ly') return d.getFullYear() === latestDateInFullSet.getFullYear() - 1;
        return true;
    });

    if (!filtered.length) return;
    const start = filtered[0], end = filtered[filtered.length - 1];
    const valEnd = cleanNum(end[47]), valStart = cleanNum(start[47]);
    const pProfit = cleanNum(end[51]) - cleanNum(start[51]);
    const pDep = cleanNum(end[50]) - cleanNum(start[50]);
    const baseValue = valStart + pDep;
    const periodReturnPerc = baseValue !== 0 ? (pProfit / baseValue) * 100 : 0;

    document.getElementById('hero-val').innerText = '£' + valEnd.toLocaleString(undefined, {maximumFractionDigits: 0});
    document.getElementById('date-label').innerText = start[0] + ' — ' + end[0];

    let displayPerc = (currentPeriod === 'all') ? 
        ((valEnd - (valEnd - cleanNum(end[51]))) / (valEnd - cleanNum(end[51])) * 100) : periodReturnPerc;

    // Update Return Metric Color
    const trVal = document.getElementById('stat-total-return');
    trVal.innerText = (displayPerc < 0 ? '-' : '') + Math.abs(displayPerc).toFixed(2) + '%';
    trVal.parentElement.className = `card p-6 border-l-4 ${displayPerc >= 0 ? 'border-emerald-500' : 'border-rose-500'}`;
    trVal.className = `text-2xl font-bold ${displayPerc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    // Update Profit Metric Color
    const npVal = document.getElementById('stat-profit');
    npVal.innerText = (pProfit < 0 ? '-' : '+') + '£' + Math.abs(pProfit).toLocaleString(undefined, {maximumFractionDigits: 0});
    npVal.parentElement.className = `card p-6 border-l-4 ${pProfit >= 0 ? 'border-emerald-500' : 'border-rose-500'}`;
    npVal.className = `text-2xl font-bold ${pProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

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
    document.getElementById('stat-twr').innerText = Math.abs((cumFactor - 1) * 100).toFixed(2) + '%';
    
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

    // Create a smooth vertical gradient for the fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    if (currentChartMode === 'growth') {
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(r => parseDate(r[0])),
            datasets: [{
                data: data.map(r => currentChartMode === 'growth' ? cleanNum(r[47]) : cleanNum(r[51])),
                borderColor: currentChartMode === 'growth' ? '#10b981' : '#3b82f6',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.4, // Essential for the smooth curved look
                cubicInterpolationMode: 'monotone', // Keeps curves natural
                fill: true,
                backgroundColor: gradient
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false }, // Shows tooltips easily on hover
            plugins: { 
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    padding: 10,
                    bodySpacing: 5,
                    callbacks: {
                        title: context => data[context[0].dataIndex][0], // Restores date in tooltip
                        label: context => new Intl.NumberFormat('en-GB', { 
                            style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 
                        }).format(context.parsed.y)
                    }
                }
            },
            scales: {
                y: { 
                    position: 'right', 
                    ticks: { 
                        color: '#71717a', 
                        font: { size: 10 },
                        // Restores the "£10k" format for readability
                        callback: v => '£' + (v / 1000).toFixed(0) + 'k' 
                    }, 
                    grid: { color: 'rgba(255, 255, 255, 0.03)' } 
                },
                x: { 
                    ticks: { 
                        color: '#71717a', 
                        font: { size: 10 }, 
                        autoSkip: true,
                        maxTicksLimit: 8,
                        callback: function(val, index) {
                            const date = this.getLabelForValue(val);
                            if (currentPeriod === 'all') {
                                return date.getFullYear() + ' ' + date.toLocaleString('default', { month: 'short' });
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
