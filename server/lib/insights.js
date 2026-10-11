// Pure insight computations — no I/O, fully unit-testable.
// Each function takes plain data in, returns plain data out.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 1. expiringSoon
// Products with an expiry_date within the next `days` days from `now`
// (including already-expired items, most urgent first).
// ---------------------------------------------------------------------------

/**
 * @param {Array<{id:number,name:string,quantity:number,expiry_date:string|null}>} products
 * @param {number} days       window size in days
 * @param {Date}   [now]      reference time (defaults to now) — injectable for tests
 * @returns {Array<{id:number,name:string,quantity:number,expiry_date:string,daysLeft:number,reason:string}>}
 */
function findExpiringSoon(products, days, now = new Date()) {
  const end = now.getTime() + days * MS_PER_DAY;
  const todayStr = new Date(now).toISOString().slice(0, 10);

  const hits = [];
  for (const p of products) {
    if (!p.expiry_date) continue;
    const exp = new Date(`${String(p.expiry_date).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(exp.getTime())) continue;

    const expiryStr = exp.toISOString().slice(0, 10);
    // expiry later today still counts ("expires in 0 days"), so compare date strings
    if (expiryStr > todayStr && exp.getTime() > end) continue;

    const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / MS_PER_DAY);
    hits.push({
      id: p.id,
      name: p.name,
      quantity: p.quantity,
      expiry_date: expiryStr,
      daysLeft,
      reason: daysLeft < 0
        ? `Expired ${-daysLeft} day${-daysLeft === 1 ? '' : 's'} ago — remove from sellable stock.`
        : daysLeft === 0
          ? 'Expires today — discount immediately or pull from stock.'
          : `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — run a promotion before it expires.`
    });
  }

  // Most urgent first: expired first, then soonest expiry
  hits.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  return hits;
}

// ---------------------------------------------------------------------------
// 2. underperforming
// Products whose units sold over the last 30 days are below `pct`% of the
// current stock on hand — flagged for discount or removal.
// ---------------------------------------------------------------------------

/**
 * @param {Array<{id:number,name:string,quantity:number,price:number}>} products
 * @param {Map<number,number>} unitsSoldLast30   productId -> units sold (last 30 days)
 * @param {number} pct  threshold percent (e.g. 10 means sold < 10% of stock)
 * @param {Date}   [now] injectable reference time for tests
 * @returns {Array<{id:number,name:string,quantity:number,unitsSold30d:number,sellThroughPct:number,reason:string}>}
 */
function findUnderperforming(products, unitsSoldLast30, pct, now = new Date()) {
  const out = [];
  for (const p of products) {
    const sold = unitsSoldLast30.get(p.id) || 0;
    if (p.quantity <= 0) continue; // nothing on hand to shift

    const sellThroughPct = Math.round((sold / p.quantity) * 1000) / 10; // 1 decimal
    if (sellThroughPct >= pct) continue; // healthy enough

    out.push({
      id: p.id,
      name: p.name,
      quantity: p.quantity,
      unitsSold30d: sold,
      sellThroughPct,
      reason: sold === 0
        ? `No sales in the last 30 days with ${p.quantity} unit${p.quantity === 1 ? '' : 's'} on hand — consider a clearance discount or discontinuing.`
        : `Sold only ${sold} unit${sold === 1 ? '' : 's'} (last 30 days) against ${p.quantity} in stock — moving slowly, discount or phase out.`
    });
  }

  // Worst first: lowest sell-through, then largest holding
  out.sort((a, b) =>
    a.sellThroughPct - b.sellThroughPct || b.quantity - a.quantity
  );
  return out;
}

module.exports = { findExpiringSoon, findUnderperforming };
