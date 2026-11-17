import {validDay} from "./bookings.mjs";

export async function dashboardFinance(db,from,to) {
  const start = from + "-01";
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) ||
      !validDay(start) || !validDay(to + "-01") || to < from || to.slice(0,4) === "9999") return null;
  const months = [];
  const date = new Date(start + "T00:00:00Z");
  while (date.toISOString().slice(0,7) <= to) {
    if (months.length >= 120) return null;
    months.push(date.toISOString().slice(0,7));
    date.setUTCMonth(date.getUTCMonth()+1);
  }
  const end = date.toISOString().slice(0,10);
  const [cash,refunded] = await db.batch([
    db.prepare(`SELECT substr(occurred_on,1,7) AS month,kind,SUM(CAST(ROUND(amount*100) AS INTEGER)) AS cents
      FROM transactions WHERE occurred_on>=? AND occurred_on<? GROUP BY month,kind`).bind(start,end),
    db.prepare(`WITH refunded AS (
      SELECT stay_id,SUM(CAST(ROUND(amount*100) AS INTEGER)) AS cents
      FROM transactions WHERE kind='refund' AND stay_id IS NOT NULL AND amount>0 GROUP BY stay_id
    ), receipts AS (
      SELECT t.occurred_on,r.cents AS refunded_cents,CAST(ROUND(t.amount*100) AS INTEGER) AS paid_cents,
        SUM(CAST(ROUND(t.amount*100) AS INTEGER)) OVER (
          PARTITION BY t.stay_id ORDER BY t.occurred_on,t.id ROWS UNBOUNDED PRECEDING
        ) AS cumulative_cents
      FROM refunded r JOIN transactions t ON t.stay_id=r.stay_id
      WHERE t.kind='income' AND t.auto_stay=0 AND t.occurred_on<?
    )
    SELECT substr(occurred_on,1,7) AS month,
      SUM(MIN(paid_cents,MAX(0,refunded_cents-(cumulative_cents-paid_cents)))) AS cents
    FROM receipts WHERE occurred_on>=? GROUP BY month`).bind(end,start),
  ]);
  const rows = new Map(months.map((month) => [month,{month,income:0,refund:0,expense:0,returned:0}]));
  for (const row of cash.results) rows.get(row.month)[row.kind] = row.cents;
  for (const row of refunded.results) rows.get(row.month).returned = row.cents;
  const totals = {income_cents:0,refund_cents:0,expense_cents:0,cash_flow_cents:0};
  const trend = [];
  for (const row of rows.values()) {
    const retained = row.income-row.returned;
    totals.income_cents += retained;
    totals.refund_cents += row.refund;
    totals.expense_cents += row.expense;
    totals.cash_flow_cents += row.income-row.refund-row.expense;
    trend.push({month:row.month,income_cents:retained,expense_cents:row.expense});
  }
  return {totals,trend};
}
