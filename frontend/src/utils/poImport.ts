/**
 * 進貨單 Excel 匯入解析
 *
 * 只讀「輸入欄」（表格裡的黃色格子，例如單價、數量、重量、匯率），
 * 公式欄（訂貨金額、集運費、進貨成本、單品成本、蝦皮抽成、毛利…）一律忽略，
 * 匯入後交給 poCalculations 重新計算，避免 Excel 快取值和系統算法不一致。
 *
 * 欄位以表頭名稱對應（不看欄位順序），所以系統自己的「匯出」檔也能匯回來。
 */
import * as XLSX from 'xlsx';

export interface ImportedPORow {
    rowNumber: number; // Excel 列號（1-based），給警告訊息用
    supplier_name?: string;
    category?: string;
    name: string;
    source_url?: string;
    style?: string;
    size?: string;
    sku?: string;
    image_url?: string;
    price_rmb?: number;
    quantity?: number;
    shipping_rmb?: number;
    weight_kg?: number;
    exchange_rate?: number;
    shipping_rate_twd?: number;
    sales_price?: number;
    is_confirmed?: boolean;
    pricing_strategy?: 'traffic' | 'profit';
    min_price?: number;
    max_price?: number;
}

export interface POImportResult {
    rows: ImportedPORow[];
    tariff?: number;
    warnings: string[];
}

type FieldKey = Exclude<keyof ImportedPORow, 'rowNumber'>;

// 表頭（正規化後）→ 欄位。公式欄刻意不列在這裡。
const HEADER_MAP: Record<string, FieldKey> = {
    '供應商': 'supplier_name',
    '供應商名稱': 'supplier_name',
    '類別': 'category',
    '商品名稱': 'name',
    '訂貨連結': 'source_url',
    '款式': 'style',
    '尺寸': 'size',
    'sku': 'sku',
    '圖片連結': 'image_url',
    '訂貨單價(cny)': 'price_rmb',
    '訂購數量': 'quantity',
    '境內運費(選填)': 'shipping_rmb',
    '境內運費': 'shipping_rmb',
    '每件重量(kg)': 'weight_kg',
    'cny匯率': 'exchange_rate',
    '1公斤集運費(ntd)': 'shipping_rate_twd',
    '預計售價(台幣售價)': 'sales_price',
    '預計售價': 'sales_price',
    '訂購確認': 'is_confirmed',
    '定價策略': 'pricing_strategy',
    '最低價': 'min_price',
    '最高價': 'max_price',
};

const NUMBER_FIELDS = new Set<FieldKey>([
    'price_rmb', 'quantity', 'shipping_rmb', 'weight_kg', 'exchange_rate',
    'shipping_rate_twd', 'sales_price', 'min_price', 'max_price',
]);

const normalizeHeader = (value: unknown): string =>
    String(value ?? '')
        .replace(/\s+/g, '')
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .toLowerCase();

const toText = (value: unknown): string | undefined => {
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    return text === '' ? undefined : text;
};

const toNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    const text = toText(value);
    if (text === undefined) return undefined;
    const num = Number(text.replace(/[,$¥￥\s]/g, ''));
    return Number.isFinite(num) ? num : undefined;
};

const toBoolean = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = (toText(value) || '').toLowerCase();
    return ['1', 'true', 'yes', 'y', 'v', '是', '✓', '✔'].includes(text);
};

const toStrategy = (value: unknown): 'traffic' | 'profit' | undefined => {
    const text = toText(value);
    if (!text) return undefined;
    if (text.includes('引流') || text.toLowerCase() === 'traffic') return 'traffic';
    if (text.includes('毛利') || text.toLowerCase() === 'profit') return 'profit';
    return undefined;
};

/** 在工作表裡找「關稅」標籤，取它右邊（或下方）第一個數字 */
const findTariff = (rows: unknown[][]): number | undefined => {
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r] || [];
        for (let c = 0; c < row.length; c++) {
            if (normalizeHeader(row[c]) !== '關稅') continue;
            for (let cc = c + 1; cc < row.length; cc++) {
                const num = toNumber(row[cc]);
                if (num !== undefined) return num;
            }
            const below = toNumber(rows[r + 1]?.[c]);
            if (below !== undefined) return below;
        }
    }
    return undefined;
};

/** 解析二維陣列（sheet_to_json header:1 的格式）。純函式，方便測試。 */
export const parsePurchaseSheetRows = (rows: unknown[][]): POImportResult => {
    const warnings: string[] = [];

    // 表頭可能不在第一列，往下找含「商品名稱」的那一列
    const headerIndex = rows.slice(0, 20).findIndex(row =>
        (row || []).some(cell => normalizeHeader(cell) === '商品名稱'));
    if (headerIndex < 0) {
        return { rows: [], warnings: ['找不到表頭（需要有「商品名稱」欄位）'] };
    }

    const columnFields = new Map<number, FieldKey>();
    const headerRow = rows[headerIndex] || [];
    headerRow.forEach((cell, col) => {
        const field = HEADER_MAP[normalizeHeader(cell)];
        if (field && ![...columnFields.values()].includes(field)) columnFields.set(col, field);
    });

    const result: ImportedPORow[] = [];
    for (let r = headerIndex + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const record: Partial<ImportedPORow> = { rowNumber: r + 1 };
        columnFields.forEach((field, col) => {
            const raw = row[col];
            if (NUMBER_FIELDS.has(field)) {
                const num = toNumber(raw);
                if (num !== undefined) (record as any)[field] = num;
                else if (toText(raw) !== undefined) {
                    warnings.push(`第 ${r + 1} 列「${toText(headerRow[col])}」不是數字（${toText(raw)}），已略過`);
                }
            } else if (field === 'is_confirmed') {
                record.is_confirmed = toBoolean(raw);
            } else if (field === 'pricing_strategy') {
                record.pricing_strategy = toStrategy(raw);
            } else {
                const text = toText(raw);
                if (text !== undefined) (record as any)[field] = text;
            }
        });

        // 沒有商品名稱的列視為空白列或底下的合計區，直接略過
        if (!record.name) continue;

        if (record.quantity === undefined || record.quantity <= 0 || !Number.isInteger(record.quantity)) {
            warnings.push(`第 ${r + 1} 列「${record.name}」訂購數量無效（${record.quantity ?? '空白'}），已先設為 1，請確認`);
            record.quantity = 1;
        }
        result.push(record as ImportedPORow);
    }

    if (result.length === 0) warnings.push('表格裡沒有任何商品資料');

    return { rows: result, tariff: findTariff(rows), warnings };
};

/** 讀取 Excel 檔：用第一個找得到表頭的工作表 */
export const parsePurchaseSheetFile = async (file: File | Blob): Promise<POImportResult> => {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    let fallback: POImportResult | undefined;
    for (const sheetName of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
        const parsed = parsePurchaseSheetRows(rows);
        if (parsed.rows.length > 0) return parsed;
        fallback ??= parsed;
    }
    return fallback ?? { rows: [], warnings: ['檔案裡沒有工作表'] };
};
