// =============================================================================
// CONSTANTS
// =============================================================================
const PERF_CSV = 'https://cdn.jsdelivr.net/gh/stocksandcofe-beep/Stock-Portfolio@main/Files/performance.csv';

const COL_DATE   = 0;
const COL_VALUE  = 47;
const COL_FLOWS  = 50;
const COL_PROFIT = 51;
const COL_SPY    = 52;

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

function parseDate(dStr) {
    if (!dStr || typeof dStr !== 'string') return null;
    const p = dStr.split('/');
    if (p.length !== 3) return null;
    const d = new Date(p[2], p[0] - 1, p[1]);
    return isNaN(d.getTime()) ? null : d;
}

function formatGBP(val, decimals = 0) {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency', currency: 'GBP',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(val);
}

// Formats a date object as "01 Jan 2024"
function formatDateLabel(dStr) {
    const d = parseDate(dStr);
    if (!d) return dStr;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}


// =============================================================================
// DATA LOAD
// =============================================================================
Papa.parse(PERF_CSV, {
    download: true,
    header: false,
    skipEmptyLines: true,
    complete(results) {
        rawPerfData = results.data.slice(1).filter(r => {
            return r[COL_DATE] && r[COL_VALUE] && parseDate(r[COL_DATE]) !== null;
        });
        hideLoadingState();
        initDashboard();
    },
    error() {
        showError('Failed to load performance data. Please try refreshing.');
    },
});

function hideLoadingState() {
    const el = document.getElementById('loading-state');
    if (el) el.classList.add('hidden');
    const main = document.getElementById('dashboard-content');
    if (main) main.classList.remove('hidden');
}

function showError(msg) {
    const el = document.getElementById('loading-state');
    if (el) {
        el.innerHTML = `<p class="text-rose-400 text-sm">${msg}</p>`;
    }
}


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
    ['growth', 'profit'].forEach(id => {
        const btn = document.getElementById('btn-' + id);
        if (btn) btn.classList.toggle('active', id === m);
    });
    initDashboard();
}


// =============================================================================
// MAIN DASHBOARD
// =============================================================================
function initDashboard() {
    if (!rawPerfData.length) return;

    const latestDate = parseDate(rawPerfData[rawPerfData.length - 1][COL_DATE]);
    const oneYearAgo = new Date(latestDate);
    oneYearAgo.setFullYear(latestDate.getFullYear() - 1);

    const filtered = rawPerfData.filter(r => {
        const d = parseDate(r[COL_DATE]);
        if (!d) return false;
        if (currentPeriod === 'ytd') return d.getFullYear() === latestDate.getFullYear();
        if (currentPeriod === '1y')  return d >= oneYearAgo;
        if (currentPeriod === 'ly')  return d.getFullYear() === latestDate.getFullYear() - 1;
        return true;
    });

    if (!filtered.length) return;

    const start  = filtered[0];
    const end    = filtered[filtered.length - 1];
    const valEnd = cleanNum(end[COL_VALUE]);

    const pProfit        = cleanNum(end[COL_PROFIT]) - cleanNum(start[COL_PROFIT]);
    const pDeposits      = cleanNum(end[COL_FLOWS])  - cleanNum(start[COL_FLOWS]);
    const baseValue      = cleanNum(start[COL_VALUE]) + pDeposits;
    const periodReturnPerc = baseValue !== 0 ? (pProfit / baseValue) * 100 : 0;

    const cumProfit     = cleanNum(end[COL_PROFIT]);
    const costBasis     = valEnd - cumProfit;
    const allReturnPerc = costBasis !== 0 ? (cumProfit / costBasis) * 100 : 0;
    const displayPerc   = currentPeriod === 'all' ? allReturnPerc : periodReturnPerc;

    const costBasisPeriod = valEnd - cleanNum(end[COL_PROFIT]) + cleanNum(start[COL_PROFIT]);
    const profitPerc      = costBasisPeriod !== 0 ? (pProfit / costBasisPeriod) * 100 : 0;
    const heroPerc        = currentChartMode === 'profit' ? profitPerc : displayPerc;

    const heroEl     = document.getElementById('hero-val');
    heroEl.innerText = (heroPerc >= 0 ? '+' : '') + heroPerc.toFixed(2) + '%';
    heroEl.className = `text-3xl font-bold tracking-tight ${heroPerc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    // Date range label — formatted as "DD MMM YYYY — DD MMM YYYY"
    document.getElementById('date-label').innerText =
        formatDateLabel(start[COL_DATE]) + ' — ' + formatDateLabel(end[COL_DATE]);

    document.getElementById('hero-label').innerText =
        currentChartMode === 'profit' ? 'Total Net Profit' : 'Total Return';

    document.getElementById('hero-badge').classList.add('hidden');

    // Last Updated label — taken from the last row's date in the CSV
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl) {
        lastUpdatedEl.innerText = 'Last updated: ' + formatDateLabel(rawPerfData[rawPerfData.length - 1][COL_DATE]);
    }

    // Total Net Value card
    const trVal = document.getElementById('stat-total-return');
    trVal.innerText = formatGBP(valEnd);
    trVal.parentElement.className = 'card p-6 border-l border-zinc-700';
    trVal.className = `text-lg font-bold ${valEnd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    // Net Profit card
    const npVal = document.getElementById('stat-profit');
    npVal.innerText = (pProfit >= 0 ? '+' : '') + formatGBP(pProfit);
    npVal.parentElement.className = 'card p-6 border-l border-zinc-700';
    npVal.className = `text-lg font-bold ${pProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    calculateMetrics(filtered);
    renderChart(filtered);
}


// =============================================================================
// METRICS
// =============================================================================
function calculateMetrics(data) {
    let cumFactor  = 1;
    let pairedRets = [];
    let peak       = cleanNum(data[0][COL_VALUE]);
    let maxDD      = 0;

    for (let i = 1; i < data.length; i++) {
        const prevVal = cleanNum(data[i - 1][COL_VALUE]);
        const currVal = cleanNum(data[i][COL_VALUE]);
        const flow    = cleanNum(data[i][COL_FLOWS]) - cleanNum(data[i - 1][COL_FLOWS]);
        const denom   = prevVal + flow;
        const spyPrev = cleanNum(data[i - 1][COL_SPY]);
        const spyCurr = cleanNum(data[i][COL_SPY]);

        if (denom > 0 && spyPrev > 0) {
            const portRet = (currVal / denom) - 1;
            const spyRet  = (spyCurr / spyPrev) - 1;
            cumFactor *= (1 + portRet);
            pairedRets.push({ port: portRet, spy: spyRet });
        }

        if (currVal > peak) peak = currVal;
        const dd = peak !== 0 ? (currVal - peak) / peak : 0;
        if (dd < maxDD) maxDD = dd;
    }

    // Max Drawdown — always negative value, styled rose
    const ddEl = document.getElementById('stat-max-dd');
    ddEl.innerText = '-' + Math.abs(maxDD * 100).toFixed(2) + '%';
    ddEl.className = 'text-lg font-bold text-rose-400';

    // TWR
    const twr   = (cumFactor - 1) * 100;
    const twrEl = document.getElementById('stat-twr');
    twrEl.innerText = (twr >= 0 ? '+' : '') + twr.toFixed(2) + '%';
    twrEl.parentElement.className = 'card p-6 border-l border-zinc-700';
    twrEl.className = `text-lg font-bold ${twr >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    if (pairedRets.length > 1) {
        const portRets = pairedRets.map(p => p.port);
        const spyRets  = pairedRets.map(p => p.spy);

        // Sharpe Ratio — colour: >= 2 emerald, >= 1 amber, < 1 rose
        const portMean = portRets.reduce((a, b) => a + b, 0) / portRets.length;
        const variance = portRets.reduce((a, b) => a + Math.pow(b - portMean, 2), 0) / portRets.length;
        const sd       = Math.sqrt(variance);
        const sharpe   = sd > 0
            ? ((portMean * 252) - RISK_FREE_RATE) / (sd * Math.sqrt(252))
            : 0;
        const sharpeEl    = document.getElementById('stat-sharpe');
        sharpeEl.innerText = sharpe.toFixed(2);
        sharpeEl.className = `text-lg font-bold ${
            sharpe >= 2 ? 'text-emerald-400' :
            sharpe >= 1 ? 'text-amber-400'   :
                          'text-rose-400'
        }`;

        // Beta — colour: < 0.8 emerald (low risk), 0.8–1.2 amber (market-like), > 1.2 rose (high risk)
        const spyMean = spyRets.reduce((a, b) => a + b, 0) / spyRets.length;
        let cov = 0, spyVar = 0;
        for (let i = 0; i < pairedRets.length; i++) {
            cov    += (portRets[i] - portMean) * (spyRets[i] - spyMean);
            spyVar += Math.pow(spyRets[i] - spyMean, 2);
        }
        const beta   = spyVar !== 0 ? cov / spyVar : 0;
        const betaEl = document.getElementById('stat-beta');
        betaEl.innerText = beta.toFixed(2);
        betaEl.className = `text-lg font-bold ${
            beta < 0.8  ? 'text-emerald-400' :
            beta <= 1.2 ? 'text-amber-400'   :
                          'text-rose-400'
        }`;
    }
}


// =============================================================================
// CHART
// =============================================================================
function renderChart(data) {
    const ctx = document.getElementById('mainChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const isGrowth = currentChartMode === 'growth';
    const color    = isGrowth ? '16, 185, 129' : '59, 130, 246';

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, `rgba(${color}, 0.2)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);

    // Profit mode: colour segments red when profit is negative
    const profitData   = data.map(r => cleanNum(r[COL_PROFIT]));
    const segmentColor = !isGrowth
        ? {
            borderColor: ctx2 => {
                const i = ctx2.p1DataIndex;
                return profitData[i] < 0 ? 'rgb(244, 63, 94)' : `rgb(${color})`;
            },
            backgroundColor: ctx2 => {
                const i = ctx2.p1DataIndex;
                return profitData[i] < 0 ? 'rgba(244, 63, 94, 0.15)' : gradient;
            },
          }
        : {};

    // SPY benchmark — actual USD price on left y-axis, Value mode only
    const spyDataset = [];
    const hasSpy     = isGrowth && cleanNum(data[0][COL_SPY]) > 0;
    if (hasSpy) {
        spyDataset.push({
            label:                  'SPY (USD)',
            data:                   data.map(r => {
                const spy = cleanNum(r[COL_SPY]);
                return spy > 0 ? spy : null;
            }),
            borderColor:            'rgb(251, 191, 36)', // amber-400
            borderWidth:            1.5,
            borderDash:             [4, 4],
            pointRadius:            0,
            tension:                0.4,
            cubicInterpolationMode: 'monotone',
            fill:                   false,
            yAxisID:                'ySpy',
        });
    }

    // Portfolio dataset — always uses its own right y-axis in GBP
    const datasets = [
        {
            label:                  'Portfolio (GBP)',
            data:                   data.map(r => isGrowth ? cleanNum(r[COL_VALUE]) : cleanNum(r[COL_PROFIT])),
            borderColor:            isGrowth ? `rgb(${color})` : undefined,
            borderWidth:            2,
            pointRadius:            0,
            tension:                0.4,
            cubicInterpolationMode: 'monotone',
            fill:                   true,
            backgroundColor:        isGrowth ? gradient : undefined,
            segment:                segmentColor,
            yAxisID:                'y',
        },
        ...spyDataset,
    ];

    // Scales — portfolio GBP on right, SPY USD on left (only in Value mode)
    // niceStep: picks the smallest value from [1,2,2.5,5,10] * 10^n that gives 4–6 ticks
    function niceStep(range) {
        if (!range || range <= 0) return 1;
        const rough    = range / 5; // target ~5 ticks
        const mag      = Math.pow(10, Math.floor(Math.log10(rough)));
        const frac     = rough / mag;
        // Pick the next clean multiplier above frac
        const steps    = [1, 2, 2.5, 5, 10];
        const mult     = steps.find(s => s >= frac) || 10;
        return mult * mag;
    }

    const portValues = data.map(r => isGrowth ? cleanNum(r[COL_VALUE]) : cleanNum(r[COL_PROFIT])).filter(Boolean);
    const portMin    = Math.min(...portValues);
    const portMax    = Math.max(...portValues);
    const portStep   = niceStep(portMax - portMin);

    const spyValues  = hasSpy ? data.map(r => cleanNum(r[COL_SPY])).filter(Boolean) : [];
    const spyMin     = hasSpy ? Math.min(...spyValues) : 0;
    const spyMax     = hasSpy ? Math.max(...spyValues) : 0;
    const spyStep    = niceStep(spyMax - spyMin);

    const yScales = {
        y: {
            position: 'right',
            ticks: {
                color:    '#71717a',
                font:     { size: 10 },
                stepSize: portStep,
                callback: v => isGrowth
                    ? '£' + (v / 1000).toFixed(0) + 'k'
                    : (v >= 0 ? '+£' : '-£') + (Math.abs(v) / 1000).toFixed(0) + 'k',
            },
            grid: { color: 'rgba(255, 255, 255, 0.03)' },
        },
        ...(hasSpy ? {
            ySpy: {
                position: 'left',
                ticks: {
                    color:    '#d97706',
                    font:     { size: 10 },
                    stepSize: spyStep,
                    callback: v => '$' + (v / 1000).toFixed(1) + 'k',
                },
                grid: { display: false },
            },
        } : {}),
    };

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels:   data.map(r => parseDate(r[COL_DATE])),
            datasets: datasets,
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display:  hasSpy,
                    position: 'top',
                    align:    'end',
                    labels: {
                        color:           '#71717a',
                        font:            { size: 11, family: 'Plus Jakarta Sans' },
                        usePointStyle:   true,
                        pointStyleWidth: 24,
                        generateLabels: chart => chart.data.datasets.map((ds, i) => ({
                            text:         ds.label,
                            fontColor:    '#71717a',
                            strokeStyle:  ds.borderColor,
                            fillStyle:    'transparent',
                            lineWidth:    ds.borderWidth,
                            lineDash:     ds.borderDash || [],
                            pointStyle:   'line',
                            hidden:       !chart.isDatasetVisible(i),
                            datasetIndex: i,
                        })),
                    },
                },
                tooltip: {
                    displayColors: hasSpy,
                    padding:       10,
                    bodySpacing:   5,
                    callbacks: {
                        title: context => formatDateLabel(data[context[0].dataIndex][COL_DATE]),
                        label: context => {
                            const v = context.parsed.y;
                            if (context.dataset.label === 'SPY (USD)') {
                                return ' SPY: $' + (v !== null ? (v / 1000).toFixed(1) + 'k' : '--');
                            }
                            return ' Portfolio: ' + formatGBP(v);
                        },
                    },
                },
            },
            scales: {
                ...yScales,
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
