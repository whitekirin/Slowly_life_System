/**
 * 盤點以「商品名稱」為單位只填一個合計數量，但庫存記在各 SKU 上，
 * 所以要把合計數量換算回各 SKU 的實際數量。
 *
 * 差異（合計 - 系統合計）依各 SKU 的系統庫存比例分攤，四捨五入後的零頭
 * 算給系統庫存最多的 SKU；任何 SKU 都不會被分到負數，扣不夠的部分改由
 * 還有庫存的 SKU（由多到少）吸收。回傳的陣列順序與傳入的 systemQuantities 相同。
 */
export function allocateStockTakeTotal(systemQuantities: number[], actualTotal: number): number[] {
    const n = systemQuantities.length;
    if (n === 0) return [];
    const total = Math.max(0, Math.round(actualTotal));
    const systemTotal = systemQuantities.reduce((sum, q) => sum + q, 0);

    // 依系統庫存由多到少排的索引（同數量時保持原順序），零頭與不足額都照這個順序處理
    const byLargest = systemQuantities
        .map((q, i) => ({ q, i }))
        .sort((a, b) => b.q - a.q || a.i - b.i)
        .map(({ i }) => i);

    if (systemTotal <= 0) {
        const result = new Array(n).fill(0);
        result[byLargest[0]] = total;
        return result;
    }

    const diff = total - systemTotal;
    const result = systemQuantities.map((q) => q + Math.round((diff * q) / systemTotal));

    // 先把負數拉回 0，再把所有誤差（四捨五入零頭＋拉回的量）補到/扣自庫存多的 SKU
    for (let i = 0; i < n; i++) if (result[i] < 0) result[i] = 0;
    let remainder = total - result.reduce((sum, q) => sum + q, 0);
    if (remainder > 0) {
        result[byLargest[0]] += remainder;
    } else {
        for (const i of byLargest) {
            if (remainder === 0) break;
            const take = Math.min(result[i], -remainder);
            result[i] -= take;
            remainder += take;
        }
    }
    return result;
}
