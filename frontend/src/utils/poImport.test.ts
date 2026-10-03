import { describe, expect, it } from 'vitest';
import { parsePurchaseSheetRows } from './poImport';

// 與「進貨單」試算表相同的表頭（含換行、公式欄）
const HEADER = [
    '類別', '商品名稱', '訂貨連結', '款式', '訂貨單價(CNY)', '訂購數量', '境內運費(選填)', '每件重量(Kg)',
    '訂貨金額(CNY)', 'CNY匯率', '1公斤集運費(NTD)', '集運費(NTD)', '進貨成本(NTD)', '單品成本\n(NTD)',
    '預計售價\n(台幣售價)', '蝦皮金流抽成(16%)', '毛利額', '毛利率', '訂購確認', '定價策略', '最低價', '最高價', '安全值產出比',
];

const row = (overrides: Record<number, unknown> = {}) => {
    const base: unknown[] = [
        '手機/數碼', '快充線', 'https://detail.1688.com/offer/1.html', '100W1米裸線', 5, 10, 0, 0.03,
        999, 4.679, 46, 999, 999, 999, 69, 999, 999, 999, 1, '引流款', 69, 130, 999,
    ];
    Object.entries(overrides).forEach(([i, v]) => { base[Number(i)] = v; });
    return base;
};

describe('parsePurchaseSheetRows', () => {
    it('maps input columns and ignores formula columns', () => {
        const { rows, warnings } = parsePurchaseSheetRows([HEADER, row()]);
        expect(warnings).toEqual([]);
        expect(rows).toEqual([{
            rowNumber: 2,
            category: '手機/數碼',
            name: '快充線',
            source_url: 'https://detail.1688.com/offer/1.html',
            style: '100W1米裸線',
            price_rmb: 5,
            quantity: 10,
            shipping_rmb: 0,
            weight_kg: 0.03,
            exchange_rate: 4.679,
            shipping_rate_twd: 46,
            sales_price: 69,
            is_confirmed: true,
            pricing_strategy: 'traffic',
            min_price: 69,
            max_price: 130,
        }]);
    });

    it('skips blank/summary rows and reads the tariff cell', () => {
        const summary: unknown[] = new Array(HEADER.length).fill(null);
        summary[11] = '關稅';
        summary[12] = 269;
        const { rows, tariff } = parsePurchaseSheetRows([HEADER, row(), [], summary]);
        expect(rows).toHaveLength(1);
        expect(tariff).toBe(269);
    });

    it('finds a header that is not on the first row and trims text', () => {
        const { rows } = parsePurchaseSheetRows([['進貨單'], HEADER, row({ 1: '  毛巾  ', 3: '白色\n\n', 19: '毛利款', 18: 0 })]);
        expect(rows[0].name).toBe('毛巾');
        expect(rows[0].style).toBe('白色');
        expect(rows[0].pricing_strategy).toBe('profit');
        expect(rows[0].is_confirmed).toBe(false);
    });

    it('defaults an invalid quantity to 1 with a warning', () => {
        const { rows, warnings } = parsePurchaseSheetRows([HEADER, row({ 5: null })]);
        expect(rows[0].quantity).toBe(1);
        expect(warnings[0]).toContain('第 2 列');
    });

    it('reports a missing header', () => {
        const { rows, warnings } = parsePurchaseSheetRows([['a', 'b'], [1, 2]]);
        expect(rows).toEqual([]);
        expect(warnings[0]).toContain('找不到表頭');
    });
});
