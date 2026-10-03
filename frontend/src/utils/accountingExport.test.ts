import { describe, it, expect } from 'vitest';
import { buildMonthlyReportSheets, cumulativeNetAt, summarizeByCategory, totalOf, type MonthlySummary, type Transaction } from './accountingExport';

const transactions: Transaction[] = [
  { id: 1, date: '2026-09-20T10:00:00', type: 'income', category: 'Sales', amount: 1500, description: '出貨單 SO1 自動產生', reference_id: 'SO-1', created_by: '出貨員甲', handled_by: '撿貨員乙' },
  { id: 2, date: '2026-09-02T09:00:00', type: 'expense', category: 'Purchase', amount: 1000, reference_id: 'PO-3', created_by: '採購員', handled_by: '驗收員', payment_method: 'Bank Transfer' },
  { id: 3, date: '2026-09-05T09:00:00', type: 'expense', category: 'Refund', amount: 200, reference_id: 'RO-1', created_by: null, handled_by: null },
  { id: 4, date: '2026-09-06T09:00:00', type: 'income', category: 'Sales', amount: 500 },
];

const summary: MonthlySummary = {
  month: '2026-09', income: 2000, expense: 1200, net: 800, sales: 2000, purchase: 1000, refund: 200,
  other_income: 0, other_expense: 0, count: 4, cumulative_net: 800,
};

describe('summarizeByCategory', () => {
  it('groups by type and category, income first, larger amounts first', () => {
    expect(summarizeByCategory(transactions)).toEqual([
      { type: 'income', category: 'Sales', count: 2, amount: 2000 },
      { type: 'expense', category: 'Purchase', count: 1, amount: 1000 },
      { type: 'expense', category: 'Refund', count: 1, amount: 200 },
    ]);
  });
});

describe('buildMonthlyReportSheets', () => {
  const { summaryRows, detailRows, categoryRows } = buildMonthlyReportSheets('2026-09', summary, transactions, 650);

  it('summary sheet has purchase cost, sales income and net', () => {
    const lookup = Object.fromEntries(summaryRows.filter((r) => r.length === 2).map(([k, v]) => [k, v]));
    expect(summaryRows[0]).toEqual(['2026-09 財務報表']);
    expect(lookup['出貨收入']).toBe(2000);
    expect(lookup['進貨成本']).toBe(1000);
    expect(lookup['退款']).toBe(200);
    expect(lookup['本月損益（收入 − 支出）']).toBe(800);
    expect(lookup['累計損益（截至 2026-09）']).toBe(650);
    expect(lookup['記帳筆數']).toBe(4);
  });

  it('detail sheet is chronological, signed, translated, and carries creator/handler', () => {
    expect(detailRows.map((r) => r.單號)).toEqual(['PO-3', 'RO-1', '', 'SO-1']);
    expect(detailRows[0]).toMatchObject({ 類型: '支出', 類別: '採購成本', 金額: -1000, 支付方式: '銀行轉帳', 建立者: '採購員', 經手者: '驗收員' });
    expect(detailRows[1]).toMatchObject({ 建立者: '', 經手者: '' });
    expect(detailRows[3]).toMatchObject({ 類型: '收入', 金額: 1500, 建立者: '出貨員甲', 經手者: '撿貨員乙' });
  });

  it('category sheet uses Chinese labels', () => {
    expect(categoryRows[0]).toEqual({ 類型: '收入', 類別: '銷售收入', 筆數: 2, 金額: 2000 });
  });
});

describe('cumulative profit/loss', () => {
  const base = { income: 0, expense: 0, sales: 0, purchase: 0, refund: 0, other_income: 0, other_expense: 0, count: 1 };
  const summaries: MonthlySummary[] = [
    { ...base, month: '2026-09', net: 300, sales: 500, other_expense: 200, cumulative_net: -100 },
    { ...base, month: '2026-07', net: -400, purchase: 400, cumulative_net: -400 },
  ];

  it('uses the latest month on or before the selected month', () => {
    expect(cumulativeNetAt(summaries, '2026-09')).toBe(-100);
    expect(cumulativeNetAt(summaries, '2026-08')).toBe(-400); // 8 月沒記帳，沿用 7 月
    expect(cumulativeNetAt(summaries, '2026-12')).toBe(-100);
    expect(cumulativeNetAt(summaries, '2026-06')).toBe(0);
  });

  it('totals every month for the overall P&L', () => {
    expect(totalOf(summaries)).toMatchObject({ net: -100, sales: 500, purchase: 400, other_expense: 200, count: 2 });
  });
});
