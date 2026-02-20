const PERF_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqzdML5fedLHG5w8t24X3PJTD-CA_Wg2_Jumz3kOQ-pL6uZCMjirW6RH2wVwd_BZyRnCzZYf0RFOGD/pub?output=csv';
const HOLD_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRBdW0eqX7wJilgANW92D9MXqElTdcSYFzLHHS_lyr0Hiw41Kt2ItdRh4eOMgpsZG95h5yoatM6xYKU/pub?gid=0&single=true&output=csv';
const LIVE_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSSXM1dYBxznBus1fR27mZ9AEfISwr54qMJHTsw6cSyPs7LAwV1sw6Y8zpC7V3gwCcH854_HudCUPEm/pub?gid=0&single=true&output=csv';
// Base URL for your uploaded logos
const LOGO_BASE_URL = 'https://raw.githubusercontent.com/stocksandcofe-beep/Stock-Portfolio/main/';

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

Papa.parse(PERF_CSV, {
    download: true, header: false, skipEmptyLines: true,
    complete: function(results) {
        const latest = results.data.filter(r => r[0] && r[47]).pop();
        totalValLatest = cleanNum(latest[47]);
        fetchLivePrices();
    }
});

function fetchLivePrices() {
    Papa.parse(LIVE_CSV, {
        download: true, header: false, skipEmptyLines: true,
        complete: function(results) {
            results.data.forEach(row => {
                const ticker = row[0]?.toUpperCase().trim();
                if (ticker) livePriceMap[ticker] = { price: cleanNum(row[1]), rate: cleanNum(row[2]) || 1.0 };
            });
            fetchHoldings();
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
        let valA, valB;
        if (key === 'Allocation') {
            valA = cleanNum(getCol(a, ['Current Value']));
            valB = cleanNum(getCol(b, ['Current Value']));
        } else if (key === 'BEP') {
            valA = cleanNum(getCol(a, ['BEP Price']));
            valB = cleanNum(getCol(b, ['BEP Price']));
        } else {
            valA = getCol(a, [key]);
            valB = getCol(b, [key]);
            if (key !== 'Company') { valA = cleanNum(valA); valB = cleanNum(valB); }
        }
        return valA > valB ? sortDir : valA < valB ? -sortDir : 0;
    });
    displayHoldings(currentHoldingsData);
}

function displayHoldings(data) {
    const tbody = document.getElementById('holdings-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    data.forEach(row => {
        const ticker = getCol(row, ['Ticker'])?.toUpperCase().trim();
        const shares = cleanNum(getCol(row, ['Shares']));
        const bepLocal = cleanNum(getCol(row, ['BEP Price']));
        const liveData = livePriceMap[ticker];
        const activePriceLocal = liveData ? liveData.price : cleanNum(getCol(row, ['Current Price']));
        const activeRate = liveData ? liveData.rate : 1.0;
        
        const curValueGBP = (shares * activePriceLocal) * activeRate;
        const weight = totalValLatest > 0 ? (curValueGBP / totalValLatest) * 100 : 0;
        const costGBP = cleanNum(getCol(row, ['Current Value'])) - cleanNum(getCol(row, ['Total Unrealised P/L'])); 
        const profitGBP = curValueGBP - costGBP;
        const percReturn = costGBP !== 0 ? ((curValueGBP / costGBP) - 1) * 100 : 0;
        
        let sym = (ticker === 'WKL') ? '€' : (ticker === 'UL' ? '£' : '$');
        
        tbody.innerHTML += `
            <tr class="hover:bg-white/5 transition border-b border-zinc-800/50 text-sm">
                <td class="p-4 text-left" style="background: linear-gradient(90deg, rgba(16, 185, 129, 0.1) ${weight}%, transparent ${weight}%);">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center overflow-hidden flex-shrink-0 border border-zinc-800">
                            <img src="${LOGO_BASE_URL}${ticker}.png" 
                                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
                                 class="w-full h-full object-contain p-1">
                            <div class="hidden w-full h-full items-center justify-center text-[10px] font-bold text-zinc-500 bg-zinc-900 uppercase">
                                ${ticker.substring(0,2)}
                            </div>
                        </div>
                        <div class="font-bold text-white leading-tight">${getCol(row, ['Company'])}</div>
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
                    ${percReturn < 0 ? '-' : '+'}${Math.abs(percReturn).toFixed(2)}%
                </td>
                <td class="p-4 text-center font-medium text-zinc-300">${weight.toFixed(1)}%</td>
            </tr>`;
    });
}
