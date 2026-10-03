import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

// DB 存英文代碼（後端自動產生的紀錄也用這些值），畫面與匯出只顯示中文
export const CATEGORY_LABELS: Record<string, string> = {
  Sales: '銷售收入',
  Purchase: '採購成本',
  Refund: '退款',
  Packaging: '包材費',
  Rent: '租金',
  Salary: '薪資',
  Utilities: '水電費',
  Logistics: '物流費',
  Other: '其他',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  Cash: '現金',
  'Bank Transfer': '銀行轉帳',
  'Credit Card': '信用卡',
  'Line Pay': 'Line Pay',
  Other: '其他',
};

// 舊版後端自動產生的英文描述，顯示時轉成中文
export const translateDescription = (text?: string) => {
  if (!text) return text;
  return text
    .replace(/^Auto-generated from PO #(\S+) \(Supplier: (.*)\)$/, '採購單 #$1 自動產生（供應商：$2）')
    .replace(/^Auto-generated from SO (\S+) \(Customer: (.*)\)$/, '出貨單 $1 自動產生（客戶：$2）')
    .replace(/^Auto-generated from RO (\S+)\. Items: /, '退貨單 $1 自動產生。品項：')
    .replace(/^Auto-generated from RO (\S+)\. /, '退貨單 $1 自動產生。');
};

export interface Transaction {
  id: number;
  date: string;
  type: 'income' | 'expense' | string;
  category: string;
  amount: number;
  description?: string | null;
  payment_method?: string | null;
  reference_id?: string | null;
  created_by?: string | null;
  handled_by?: string | null;
}

// 對應後端 TransactionMonthlySummary
export interface MonthlySummary {
  month: string;
  income: number;
  expense: number;
  net: number;
  sales: number;
  purchase: number;
  refund: number;
  other_income: number;
  other_expense: number;
  count: number;
  cumulative_net: number;
}

export const emptySummary = (month: string): MonthlySummary => ({
  month, income: 0, expense: 0, net: 0, sales: 0, purchase: 0, refund: 0, other_income: 0, other_expense: 0, count: 0, cumulative_net: 0,
});

/**
 * 截至某月（含）的累計損益。該月沒記帳時沿用它之前最近一個有記帳月份的累計值；更早都沒有則為 0。
 * summaries 需為後端回傳的新到舊順序。
 */
export const cumulativeNetAt = (summaries: MonthlySummary[], month: string) =>
  summaries.find((s) => s.month <= month)?.cumulative_net ?? 0;

/** 全部月份加總（目前總損益的拆項）。 */
export const totalOf = (summaries: MonthlySummary[]) =>
  summaries.reduce(
    (acc, s) => ({
      ...acc,
      income: acc.income + s.income,
      expense: acc.expense + s.expense,
      net: acc.net + s.net,
      sales: acc.sales + s.sales,
      purchase: acc.purchase + s.purchase,
      refund: acc.refund + s.refund,
      other_income: acc.other_income + s.other_income,
      other_expense: acc.other_expense + s.other_expense,
      count: acc.count + s.count,
    }),
    emptySummary('all'),
  );

export const categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category;
const typeLabel = (type: string) => (type === 'income' ? '收入' : '支出');

/** 依類型＋類別彙總筆數與金額，收入在前、金額大到小。 */
export const summarizeByCategory = (transactions: Transaction[]) => {
  const groups = new Map<string, { type: string; category: string; count: number; amount: number }>();
  for (const t of transactions) {
    const key = `${t.type}|${t.category}`;
    const group = groups.get(key) ?? { type: t.type, category: t.category, count: 0, amount: 0 };
    group.count += 1;
    group.amount += t.amount;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.type === b.type ? b.amount - a.amount : a.type === 'income' ? -1 : 1,
  );
};

/** 組出匯出用的三張工作表內容（摘要、明細、類別統計）。拆出來方便測試。 */
export const buildMonthlyReportSheets = (month: string, summary: MonthlySummary, transactions: Transaction[], cumulativeNet: number) => {
  const summaryRows: (string | number)[][] = [
    [`${month} 財務報表`],
    ['匯出時間', dayjs().format('YYYY-MM-DD HH:mm')],
    [],
    ['項目', '金額'],
    ['出貨收入', summary.sales],
    ['其他收入', summary.other_income],
    ['收入合計', summary.income],
    [],
    ['進貨成本', summary.purchase],
    ['退款', summary.refund],
    ['其他支出', summary.other_expense],
    ['支出合計', summary.expense],
    [],
    ['本月損益（收入 − 支出）', summary.net],
    [`累計損益（截至 ${month}）`, cumulativeNet],
    ['記帳筆數', summary.count],
  ];

  const detailRows = [...transactions]
    .sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf())
    .map((t) => ({
      日期: dayjs(t.date).format('YYYY-MM-DD HH:mm'),
      類型: typeLabel(t.type),
      類別: categoryLabel(t.category),
      金額: t.type === 'income' ? t.amount : -t.amount,
      描述: translateDescription(t.description ?? undefined) ?? '',
      支付方式: t.payment_method ? (PAYMENT_METHOD_LABELS[t.payment_method] ?? t.payment_method) : '',
      單號: t.reference_id ?? '',
      建立者: t.created_by ?? '',
      經手者: t.handled_by ?? '',
    }));

  const categoryRows = summarizeByCategory(transactions).map((g) => ({
    類型: typeLabel(g.type),
    類別: categoryLabel(g.category),
    筆數: g.count,
    金額: g.amount,
  }));

  return { summaryRows, detailRows, categoryRows };
};

export const exportMonthlyReport = (month: string, summary: MonthlySummary, transactions: Transaction[], cumulativeNet: number) => {
  const { summaryRows, detailRows, categoryRows } = buildMonthlyReportSheets(month, summary, transactions, cumulativeNet);
  const wb = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 28 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, '財務摘要');

  const detailSheet = XLSX.utils.json_to_sheet(detailRows, {
    header: ['日期', '類型', '類別', '金額', '描述', '支付方式', '單號', '建立者', '經手者'],
  });
  detailSheet['!cols'] = [{ wch: 17 }, { wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 50 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, detailSheet, '收支明細');

  const categorySheet = XLSX.utils.json_to_sheet(categoryRows, { header: ['類型', '類別', '筆數', '金額'] });
  XLSX.utils.book_append_sheet(wb, categorySheet, '類別統計');

  XLSX.writeFile(wb, `財務報表_${month}.xlsx`);
};
