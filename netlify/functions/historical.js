exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { ticker, startTimestamp } = body;
    if (!ticker || !startTimestamp) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing ticker or startTimestamp' }) };
    }

    const endTimestamp = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1mo&period1=${startTimestamp}&period2=${endTimestamp}`;

    try {
        const res  = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept':     'application/json',
            },
        });
        const data = await res.json();
        const result = data?.chart?.result?.[0];

        if (!result) {
            return { statusCode: 200, body: JSON.stringify({ points: [] }) };
        }

        const timestamps = result.timestamp || [];
        const closes     = result.indicators?.adjclose?.[0]?.adjclose
                        || result.indicators?.quote?.[0]?.close
                        || [];

        const points = timestamps
            .map((t, i) => ({ date: new Date(t * 1000).toISOString(), close: closes[i] }))
            .filter(d => d.close != null);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ points }),
        };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
