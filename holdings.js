const PERF_CSV = 'https://raw.githubusercontent.com/stocksandcofe-beep/Stock-Portfolio/main/Performance.csv';
const HOLD_CSV = 'https://raw.githubusercontent.com/stocksandcofe-beep/Stock-Portfolio/main/Holdings.csv';
const LIVE_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSSXM1dYBxznBus1fR27mZ9AEfISwr54qMJHTsw6cSyPs7LAwV1sw6Y8zpC7V3gwCcH854_HudCUPEm/pub?gid=0&single=true&output=csv';

let currentHoldingsData = [], livePriceMap = {}, totalValLatest = 0;
let sortKey = '', sortDir = 1;

function cleanNum(val) { return parseFloat(val?.toString().replace(/[^0-9.-]+/g, "")) || 0; }
function getCol(row, keys) {
    const rKeys = Object.keys(row);
    for (let k of keys) { 
        const f = rKeys.find(rk => rk.toLowerCase().trim() === k.toLowerCase().trim());
        if (f) return row[f];
    }
    return null;
}

// 1. Get total portfolio value first for weight calculation
Papa.parse(PERF_CSV, {
    download: true, header: false, skipEmptyLines: true,
    complete: function(results) {
        const latest = results.data.filter(r => r[0] && r[47]).pop();
        if (latest) totalValLatest = cleanNum(latest[47]);
        initLivePrices();
    }
});

function initLivePrices() {
    Papa.parse(LIVE_CSV, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) {
            results.data.forEach(r => {
                const t = getCol(r, ['Ticker'])?.toUpperCase().trim();
                const p = cleanNum(getCol(r, ['Price', 'Live Price', 'Last']));
                if (t) livePriceMap[t] = p;
            });
            loadHoldings();
        }
    });
}

function loadHoldings() {
    Papa.parse(HOLD_CSV, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) {
            currentHoldingsData = results.data.filter(r => getCol(r, ['Ticker']));
            displayHoldings(currentHoldingsData);
        }
    });
}

function sortHoldings(key) {
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = 1; }

    currentHoldingsData.sort((a, b) => {
        let valA, valB;
        // Fix for sorting BEP (Avg Price) and Allocation (Weight)
        if (key === 'Allocation') {
            valA = (cleanNum(getCol(a, ['Current Value'])) / totalValLatest);
            valB = (cleanNum(getCol(b, ['Current Value'])) / totalValLatest);
        } else {
            valA = getCol(a, [key]);
            valB = getCol(b, [key]);
            if (key !== 'Company' && key !== 'Ticker') {
                valA = cleanNum(valA);
                valB = cleanNum(valB);
            }
        }
        return valA > valB ? sortDir : valA < valB ? -sortDir : 0;
    });
    displayHoldings(currentHoldingsData);
}

function displayHoldings(data) {
    const tbody = document.getElementById('holdings-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    data.forEach(row => {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const name = getCol(row, ['Company']);
        const shares = cleanNum(getCol(row, ['Shares']));
        const bepRaw = cleanNum(getCol(row, ['Avg Price', 'Cost Basis', 'Price']));
        const curValueGBP = cleanNum(getCol(row, ['Current Value']));
        const profitGBP = cleanNum(getCol(row, ['Total Unrealised P/L', 'Profit/Loss']));
        const percReturn = cleanNum(getCol(row, ['% Return', 'Unrealised P/L %']));
        const weight = totalValLatest > 0 ? (curValueGBP / totalValLatest) * 100 : 0;
        
        const livePrice = livePriceMap[ticker];
        const sym = ticker?.endsWith('.L') ? 'p' : '$';
        const bepLocal = ticker?.endsWith('.L') ? bepRaw * 100 : bepRaw;
        const activePriceLocal = ticker?.endsWith('.L') ? livePrice * 100 : livePrice;
        const liveData = livePrice !== undefined && livePrice !== 0;

        // Extract clean ticker for logo
        const logoTicker = ticker.split('.')[0];

        const tr = document.createElement('tr');
        tr.className = "hover:bg-white/5 transition border-b border-zinc-800/50 text-sm";
        tr.innerHTML = `
            <td class="p-4 text-left" style="background: linear-gradient(90deg, rgba(16, 185, 129, 0.1) ${weight}%, transparent ${weight}%);">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                        <img src="https://img.logo.dev/ticker/${logoTicker}?token=pk_YOUR_TOKEN" 
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
                             class="w-full h-full object-contain">
                        <div class="hidden w-full h-full items-center justify-center text-[10px] font-bold text-zinc-500 bg-zinc-800 uppercase">
                            ${logoTicker.substring(0,2)}
                        </div>
                    </div>
                    <div class="flex flex-col">
                        <div class="font-bold text-white leading-tight">${name}</div>
                        <div class="text-[10px] text-zinc-500 font-mono uppercase">${ticker}</div>
                    </div>
                </div>
            </td>
            <td class="p-4 text-center font-mono text-zinc-400">${shares}</td>
            <td class="p-4 text-center text-zinc-300">${sym}${bepLocal.toFixed(2)}</td>
            <td class="p-4 text-center font-bold text-emerald-400">${liveData ? sym + activePriceLocal.toFixed(2) : '--'}</td>
            <td class="p-4 text-center font-medium text-white">£${curValueGBP.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td class="p-4 text-center font-semibold ${profitGBP >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                ${profitGBP < 0 ? '-' : '+'}£${Math.abs(profitGBP).toLocaleString(undefined, {maximumFractionDigits:0})}
            </td>
            <td class="p-4 text-center font-bold ${percReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                ${percReturn >= 0 ? '+' : ''}${percReturn.toFixed(2)}%
            </td>
            <td class="p-4 text-right font-bold text-zinc-400">${weight.toFixed(1)}%</td>
        `;
        tbody.appendChild(tr);
    });
}
