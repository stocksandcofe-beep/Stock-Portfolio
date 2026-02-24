// =============================================================================
// CONSTANTS
// =============================================================================
const PERF_CSV = 'cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Files/performance.csv';

// Column indices — update these if your spreadsheet structure changes
const COL_DATE   = 0;
const COL_VALUE  = 47; // Net portfolio value
const COL_FLOWS  = 50; // Cumulative cash flows / deposits
const COL_PROFIT = 51; // Cumulative net profit
const COL_SPY    = 52; // SPY closing price (for beta calculation)

// Risk-free rate used in Sharpe Ratio — update as rates change
const RISK_FREE_RATE = 0.045; // 4.5% annualised


// =============================================================================
// STATE
// =============================================================================
let chartInstance    = null;
let rawPerfData      = [];
let currentPeriod    = 'all';
let currentChartMode = 'growth';


// =============================================================================
// HELPERS
// =============================================================================
function cleanNum(val) {
    return parseFloat(val?.toString().replace(/[^0-9.-]+/g, '')) || 0;
}

// Parses MM/DD/YYYY date strings safely — returns null on malformed input
function parseDate(dStr) {
    if (!dStr || typeof dStr !== 'string') return null;
    const p = dStr.split('/');
    if (p.length !== 3) return null;
    const d = new Date(p[2], p[0] - 1, p[1]);
    return isNaN(d.getTime()) ? null : d;
}

// Formats a GBP value with £ symbol
function formatGBP(val, decimals = 0) {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency', currency: 'GBP',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(val);
}


// =============================================================================
// DATA LOAD
// =============================================================================
Papa.parse(PERF_CSV, {
    download: true,
    header: false,
    skipEmptyLines: true,
    complete(results) {
        // Skip header row, keep rows with a valid date and net value
        rawPerfData = results.data.slice(1).filter(r => {
            return r[COL_DATE] && r[COL_VALUE] && parseDate(r[COL_DATE]) !== null;
        });
        initDashboard();
    },
});


// =============================================================================
// PERIOD & MODE CONTROLS
// =============================================================================
function updatePeriod(p) {
    currentPeriod = p;
    ['all', 'ytd', '1y', 'ly'].forEach(id => {
        const btn = document.getElementById('p-' + id);
        if (btn) btn.classList.toggle('active', id === p);
    });
    initDashboard();
}

function updateChartMode(m) {
    currentChartMode = m;
    document.getElementById('btn-growth').classList.toggle('active', m === 'growth');
    document.getElementById('btn-profit').classList.toggle('active', m === 'profit');
    initDashboard();
}


// =============================================================================
// MAIN DASHBOARD
// =============================================================================
function initDashboard() {
    if (!rawPerfData.length) return;

    // Use the latest date in the dataset as the reference point for period filtering
    const latestDate = parseDate(rawPerfData[rawPerfData.length - 1][COL_DATE]);
    const oneYearAgo = new Date(latestDate);
    oneYearAgo.setFullYear(latestDate.getFullYear() - 1);

    const filtered = rawPerfData.filter(r => {
        const d = parseDate(r[COL_DATE]);
        if (!d) return false;
        if (currentPeriod === 'ytd') return d.getFullYear() === latestDate.getFullYear();
        if (currentPeriod === '1y')  return d >= oneYearAgo;
        if (currentPeriod === 'ly')  return d.getFullYear() === latestDate.getFullYear() - 1;
        return true; // 'all'
    });

    if (!filtered.length) return;

    const start  = filtered[0];
    const end    = filtered[filtered.length - 1];
    const valEnd = cleanNum(end[COL_VALUE]);

    // Period profit = change in cumulative profit over the filtered window
    const pProfit = cleanNum(end[COL_PROFIT]) - cleanNum(start[COL_PROFIT]);

    // Period return % — profit over (opening value + new deposits in period)
    const pDeposits      = cleanNum(end[COL_FLOWS]) - cleanNum(start[COL_FLOWS]);
    const baseValue      = cleanNum(start[COL_VALUE]) + pDeposits;
    const periodReturnPerc = baseValue !== 0 ? (pProfit / baseValue) * 100 : 0;

    // For "all": total return = cumulative profit / cost basis
    const cumProfit    = cleanNum(end[COL_PROFIT]);
    const costBasis    = valEnd - cumProfit;
    const allReturnPerc = costBasis !== 0 ? (cumProfit / costBasis) * 100 : 0;

    const displayPerc = currentPeriod === 'all' ? allReturnPerc : periodReturnPerc;

    // --- Hero value ---
    document.getElementById('hero-val').innerText = formatGBP(valEnd);
    document.getElementById('date-label').innerText = start[COL_DATE] + ' — ' + end[COL_DATE];

    // --- Hero badge: overall return % pill next to the portfolio value ---
    const badge = document.getElementById('hero-badge');
    badge.innerText = (displayPerc >= 0 ? '+' : '') + displayPerc.toFixed(2) + '%';
    badge.className = `text-sm font-bold px-3 py-1 rounded-full ${
        displayPerc >= 0
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-rose-500/15 text-rose-400'
    }`;
    badge.classList.remove('hidden');

    // --- Total Return card ---
    const trVal = document.getElementById('stat-total-return');
    trVal.innerText = (displayPerc >= 0 ? '+' : '') + displayPerc.toFixed(2) + '%';
    trVal.parentElement.className = `card p-6 border-l-4 ${displayPerc >= 0 ? 'border-emerald-500' : 'border-rose-500'}`;
    trVal.className = `text-2xl font-bold ${displayPerc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    // --- Net Profit card ---
    const npVal = document.getElementById('stat-profit');
    npVal.innerText = (pProfit >= 0 ? '+' : '') + formatGBP(pProfit);
    npVal.parentElement.className = `card p-6 border-l-4 ${pProfit >= 0 ? 'border-emerald-500' : 'border-rose-500'}`;
    npVal.className = `text-2xl font-bold ${pProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    calculateMetrics(filtered);
    renderChart(filtered);
}


// =============================================================================
// METRICS
// =============================================================================
function calculateMetrics(data) {
    let cumFactor = 1;
    let pairedRets = []; // [ { port, spy } ] — zipped together to keep in sync
    let peak = cleanNum(data[0][COL_VALUE]);
    let maxDD = 0;

    for (let i = 1; i < data.length; i++) {
        const prevVal = cleanNum(data[i - 1][COL_VALUE]);
        const currVal = cleanNum(data[i][COL_VALUE]);
        const flow    = cleanNum(data[i][COL_FLOWS]) - cleanNum(data[i - 1][COL_FLOWS]);
        const denom   = prevVal + flow;

        const spyPrev = cleanNum(data[i - 1][COL_SPY]);
        const spyCurr = cleanNum(data[i][COL_SPY]);

        // Only include this day if both portfolio AND SPY data are valid
        // This keeps the arrays in sync for an accurate beta calculation
        if (denom > 0 && spyPrev > 0) {
            const portRet = (currVal / denom) - 1;
            const spyRet  = (spyCurr / spyPrev) - 1;
            cumFactor *= (1 + portRet);
            pairedRets.push({ port: portRet, spy: spyRet });
        }

        // Max drawdown tracks all rows regardless of SPY data
        if (currVal > peak) peak = currVal;
        const dd = peak !== 0 ? (currVal - peak) / peak : 0;
        if (dd < maxDD) maxDD = dd;
    }

    // Max Drawdown — always negative, display as positive %
    document.getElementById('stat-max-dd').innerText = Math.abs(maxDD * 100).toFixed(2) + '%';

    // TWR — preserve sign so negative periods show correctly
    const twr    = (cumFactor - 1) * 100;
    const twrEl  = document.getElementById('stat-twr');
    twrEl.innerText = (twr >= 0 ? '+' : '') + twr.toFixed(2) + '%';
    twrEl.parentElement.className = `card p-6 border-l-4 ${twr >= 0 ? 'border-emerald-500' : 'border-rose-500'}`;
    twrEl.className = `text-2xl font-bold ${twr >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    if (pairedRets.length > 1) {
        const portRets = pairedRets.map(p => p.port);
        const spyRets  = pairedRets.map(p => p.spy);

        // Sharpe Ratio
        const portMean = portRets.reduce((a, b) => a + b, 0) / portRets.length;
        const variance = portRets.reduce((a, b) => a + Math.pow(b - portMean, 2), 0) / portRets.length;
        const sd       = Math.sqrt(variance);
        const sharpe   = sd > 0
            ? ((portMean * 252) - RISK_FREE_RATE) / (sd * Math.sqrt(252))
            : 0;
        document.getElementById('stat-sharpe').innerText = sharpe.toFixed(2);

        // Beta — covariance(port, spy) / variance(spy)
        const spyMean = spyRets.reduce((a, b) => a + b, 0) / spyRets.length;
        let cov = 0, spyVar = 0;
        for (let i = 0; i < pairedRets.length; i++) {
            cov    += (portRets[i] - portMean) * (spyRets[i] - spyMean);
            spyVar += Math.pow(spyRets[i] - spyMean, 2);
        }
        const beta = spyVar !== 0 ? cov / spyVar : 0;
        document.getElementById('stat-beta').innerText = beta.toFixed(2);
    }
}


// =============================================================================
// CHART
// =============================================================================
function renderChart(data) {
    const ctx = document.getElementById('mainChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const isGrowth = currentChartMode === 'growth';
    const color    = isGrowth ? '16, 185, 129' : '59, 130, 246'; // emerald : blue

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, `rgba(${color}, 0.2)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(r => parseDate(r[COL_DATE])),
            datasets: [{
                data: data.map(r => isGrowth ? cleanNum(r[COL_VALUE]) : cleanNum(r[COL_PROFIT])),
                borderColor:             `rgb(${color})`,
                borderWidth:             2,
                pointRadius:             0,
                tension:                 0.4,
                cubicInterpolationMode:  'monotone',
                fill:                    true,
                backgroundColor:         gradient,
            }],
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    padding:       10,
                    bodySpacing:   5,
                    callbacks: {
                        title: context => data[context[0].dataIndex][COL_DATE],
                        label: context => formatGBP(context.parsed.y),
                    },
                },
            },
            scales: {
                y: {
                    position: 'right',
                    ticks: {
                        color: '#71717a',
                        font:  { size: 10 },
                        callback: v => '£' + (v / 1000).toFixed(0) + 'k',
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                },
                x: {
                    ticks: {
                        color:         '#71717a',
                        font:          { size: 10 },
                        autoSkip:      true,
                        maxTicksLimit: 8,
                        callback: function(val) {
                            const date = this.getLabelForValue(val);
                            if (!date) return '';
                            return currentPeriod === 'all'
                                ? date.getFullYear() + ' ' + date.toLocaleString('default', { month: 'short' })
                                : date.toLocaleString('default', { month: 'short' });
                        },
                    },
                    grid: { display: false },
                },
            },
        },
    });
}
