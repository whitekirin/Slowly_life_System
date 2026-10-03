import { describe, expect, it } from 'vitest';
import { allocateStockTakeTotal } from './stockTakeAllocation';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('allocateStockTakeTotal', () => {
    it('keeps quantities unchanged when there is no difference', () => {
        expect(allocateStockTakeTotal([1, 20], 21)).toEqual([1, 20]);
    });

    it('splits a surplus proportionally', () => {
        expect(allocateStockTakeTotal([10, 30], 80)).toEqual([20, 60]);
    });

    it('splits a shortage proportionally', () => {
        expect(allocateStockTakeTotal([10, 30], 20)).toEqual([5, 15]);
    });

    it('gives the rounding remainder to the SKU with the most stock', () => {
        const result = allocateStockTakeTotal([1, 1, 1], 4);
        expect(sum(result)).toBe(4);
        expect(result).toEqual([2, 1, 1]);
    });

    it('never goes negative and always sums to the counted total', () => {
        for (const [system, total] of [[[1, 20], 0], [[1, 20], 3], [[1, 1, 7], 1], [[3, 3], 5], [[5], 2]] as [number[], number][]) {
            const result = allocateStockTakeTotal(system, total);
            expect(sum(result)).toBe(total);
            result.forEach((q) => expect(q).toBeGreaterThanOrEqual(0));
        }
    });

    it('clamps negative totals to zero', () => {
        expect(allocateStockTakeTotal([2, 3], -5)).toEqual([0, 0]);
    });
});
