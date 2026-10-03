
/**
 * Purchase Order Calculation Module
 * 
 * Core calculation logic for Purchase Order Items.
 * 
 * Formulas:
 * 1. Total Order Amount (RMB) = (Unit Price * ∑Quantity) + Domestic Freight (RMB)
 * 2. Total Shipping Fee (TWD) = ∑Quantity * Weight * Shipping Unit Price (TWD/Kg)
 * 3. Total Cost (NTD) = (Total Order Amount (RMB) * Exchange Rate) + Total Shipping Fee (TWD)
 * 4. Unit Cost (NTD) = Total Cost (NTD) / ∑Quantity
 */

export interface POItemInput {
    sku: string;
    unitPriceRMB: number;
    quantity: number;
    weightKg: number;
    domesticFreightRMB: number;
    shippingUnitPriceTWD: number;
    exchangeRate: number;
}

export interface POCalculationResult {
    sku: string;
    totalQuantity: number;
    totalOrderAmountRMB: number;
    totalShippingFeeTWD: number;
    totalCostNTD: number;
    unitCostNTD: number;
    totalWeightKg: number;
    
    // Detailed components for reference
    avgUnitPriceRMB: number;
    totalDomesticFreightRMB: number;
    avgWeightKg: number;
    avgShippingUnitPriceTWD: number;
    avgExchangeRate: number;
}

export interface POSummary {
    items: POCalculationResult[];
    grandTotalCostNTD: number;
    grandTotalWeightKg: number;
    grandTotalShippingFeeTWD: number;
    grandTotalOrderAmountRMB: number;
}

/**
 * Calculates Purchase Order details and summary.
 * Groups items by SKU and applies formulas.
 * 
 * @param items List of purchase order items
 * @param options Optional global settings (additional costs, discount)
 */
export const calculatePurchaseOrder = (
    items: POItemInput[], 
    options?: { 
        additionalCostNTD?: number; // e.g. Tariff
        discountNTD?: number;       // e.g. Global Discount
        globalShippingFeeNTD?: number; // Extra shipping fee not per SKU
    }
): POSummary => {
    const groupedItems = new Map<string, POItemInput[]>();

    // 1. Group by SKU
    // Logic update: If SKU is missing, generate a temporary ID to ensure it's included.
    items.forEach((item, index) => {
        const skuKey = item.sku ? item.sku : `__MISSING_SKU_${index}__`;
        const existing = groupedItems.get(skuKey) || [];
        existing.push(item);
        groupedItems.set(skuKey, existing);
    });

    const results: POCalculationResult[] = [];
    let grandTotalCostNTD = 0;
    let grandTotalWeightKg = 0;
    let grandTotalShippingFeeTWD = 0;
    let grandTotalOrderAmountRMB = 0;

    groupedItems.forEach((groupItems, skuKey) => {
        // Restore original SKU if it was a real one, or empty/temp if missing
        const sku = skuKey.startsWith('__MISSING_SKU_') ? '' : skuKey;

        // Calculate Totals for the Group
        const totalQuantity = groupItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
        
        // Sum Domestic Freight (Assuming input freight is additive per line item)
        const totalDomesticFreightRMB = groupItems.reduce((sum, item) => sum + (item.domesticFreightRMB || 0), 0);
        
        // Use first item's Unit Price, Weight, Shipping Rate, Exchange Rate as base
        // (Assuming consistent per SKU, or taking first as representative)
        const firstItem = groupItems[0];
        const unitPriceRMB = firstItem.unitPriceRMB || 0;
        const weightKg = firstItem.weightKg || 0;
        const shippingUnitPriceTWD = firstItem.shippingUnitPriceTWD || 0;
        const exchangeRate = firstItem.exchangeRate || 0;

        // Formula 1: Total Order Amount (RMB)
        // (Unit Price * ∑Quantity) + Domestic Freight (RMB)
        const totalOrderAmountRMB = (unitPriceRMB * totalQuantity) + totalDomesticFreightRMB;

        // Formula 2: Total Shipping Fee (TWD)
        // 1. Total Quantity
        // 2. Total Weight = Total Quantity * Unit Weight (Kg)
        // 3. Shipping Fee = Total Weight * Shipping Unit Price (TWD/Kg)
        
        // Precision requirement: Support 3 decimal places
        // Use parseFloat(num.toFixed(3)) to maintain precision during intermediate steps
        const totalWeightKg = parseFloat((totalQuantity * weightKg).toFixed(3));
        const skuShippingFeeRaw = parseFloat((totalWeightKg * shippingUnitPriceTWD).toFixed(3));
        
        // Note: The prompt says "Finally sum up SKU shipping fees to get Total Shipping Fee".
        // And "Final amount rounded to integer".
        // It's ambiguous if SKU fee should be rounded before summing.
        // "再將各 SKU 的總集運費加總... 最終金額以四捨五入取至整數"
        // I will keep SKU fee raw (3 decimals) for the Grand Total calculation to be precise,
        // BUT for the SKU result object `totalShippingFeeTWD`, it usually expects an integer/final value for display.
        // Let's store the RAW fee in a separate property if needed, but the interface says `totalShippingFeeTWD`.
        // If I round here, the sum might drift.
        // But usually "SKU Total Shipping Fee" implies the fee allocated to that SKU.
        // Let's assume standard behavior: SKU fee is just a component.
        // However, to satisfy "Final amount rounded", I will sum RAW fees and round at the end.
        // But `result.totalShippingFeeTWD` is used for display. I should probably round it for display consistency?
        // Or keep it raw? Existing UI expects integer?
        // Let's update the interface to carry raw values or just round here for SKU level too?
        // If I round here, Sum(Rounded) != Round(Sum(Raw)).
        // "將總重量乘以...即算出該 SKU 的總集運費" -> This sounds like a defined value.
        // Let's assume SKU fee is NOT rounded yet, or rounded to 3 decimals.
        // But `totalShippingFeeTWD` in interface implies TWD (integer).
        // Let's use `Math.round` for SKU display value, but accumulate `skuShippingFeeRaw` for Grand Total?
        // User instruction: "再將各 SKU 的總集運費加總，即為整筆訂單的總集運費" -> Sum of SKU fees IS the Total.
        // This implies Sum(SKU_Fee).
        // If "SKU_Fee" is the result of step 3, and step 5 says "Final amount rounded", maybe SKU fee is also rounded?
        // Let's stick to: SKU Fee is raw (3 decimals). Grand Total is Sum(Raw). Final Grand Total is Rounded.
        // And for SKU display, maybe we round it too?
        // Let's assign rounded value to `totalShippingFeeTWD` for UI, but use `skuShippingFeeRaw` for accumulation?
        // No, that would make Sum(UI Items) != Grand Total.
        // Let's strictly follow: "Sum of SKU fees = Total".
        // If Total is rounded, and SKU fees are components...
        // Let's keep `totalShippingFeeTWD` as the RAW value (or 3 decimals) in the object, and UI formats it?
        // UI currently displays `${val}`.
        // Let's store the rounded value in `totalShippingFeeTWD` so UI looks clean,
        // BUT accumulate raw for Grand Total? No, that violates "Sum of SKU fees = Total".
        // Let's accumulate `skuShippingFeeRaw`. And set `totalShippingFeeTWD` to `skuShippingFeeRaw`.
        // The Grand Total will be `Math.round(sum(skuShippingFeeRaw))`.
        // This means `grandTotal` might slightly differ from `sum(sku.totalShippingFeeTWD)` if we just summed rounded values.
        // But here we sum raw.
        
        const totalShippingFeeTWD = skuShippingFeeRaw; 

        // Formula 3: Total Cost (NTD)
        // (Total Order Amount (RMB) * Exchange Rate) + Total Shipping Fee (TWD)
        // Note: New requirement: "所有計算過程中出現的小數，一律採用四捨五入，精確到小數點後第二位"
        
        // Step 1: Calculate Order Amount NTD
        // (Total Order Amount (RMB) * Exchange Rate)
        const totalOrderAmountNTD_Raw = totalOrderAmountRMB * exchangeRate;
        const totalOrderAmountNTD = Math.round(totalOrderAmountNTD_Raw * 100) / 100;

        // Step 2: Calculate SKU Shipping Fee NTD (Rounded to 2 decimals)
        const skuShippingFeeRounded = Math.round(skuShippingFeeRaw * 100) / 100;

        // Step 3: Total Cost
        const totalCostNTD = Math.round((totalOrderAmountNTD + skuShippingFeeRounded) * 100) / 100;

        // Formula 4: Unit Cost (NTD)
        let unitCostNTD = 0;
        if (totalQuantity > 0) {
            unitCostNTD = totalCostNTD / totalQuantity;
            unitCostNTD = Math.round(unitCostNTD * 100) / 100;
        }

        const result: POCalculationResult = {
            sku,
            totalQuantity,
            totalOrderAmountRMB,
            totalShippingFeeTWD: skuShippingFeeRounded, // Return rounded for UI
            totalCostNTD: totalCostNTD,
            unitCostNTD,
            totalWeightKg,
            
            avgUnitPriceRMB: unitPriceRMB,
            totalDomesticFreightRMB,
            avgWeightKg: weightKg,
            avgShippingUnitPriceTWD: shippingUnitPriceTWD,
            avgExchangeRate: exchangeRate
        };

        results.push(result);

        // Accumulate Grand Totals
        grandTotalCostNTD += totalCostNTD;
        grandTotalWeightKg += totalWeightKg;
        grandTotalShippingFeeTWD += skuShippingFeeRounded; 
        grandTotalOrderAmountRMB += totalOrderAmountRMB;
    });

    const finalGrandTotalShippingFeeTWD = Math.round(grandTotalShippingFeeTWD * 100) / 100;
    
    // Apply Global Options to Grand Total Cost
    const additionalCost = options?.additionalCostNTD || 0;
    const discount = options?.discountNTD || 0;
    const extraShipping = options?.globalShippingFeeNTD || 0;

    // Total Cost = Sum(Item Costs) + Additional + Extra Shipping - Discount
    let finalGrandTotalCostNTD = grandTotalCostNTD + additionalCost + extraShipping - discount;
    finalGrandTotalCostNTD = Math.round(finalGrandTotalCostNTD * 100) / 100;

    // Note: We don't distribute global costs to unit costs here, 
    // as unit cost usually reflects the product sourcing cost. 
    // If distribution is needed, logic would be much more complex.
    // We assume these are order-level adjustments.

    return {
        items: results,
        grandTotalCostNTD: finalGrandTotalCostNTD,
        grandTotalWeightKg,
        grandTotalShippingFeeTWD: finalGrandTotalShippingFeeTWD + extraShipping, // Should we include extra shipping here? Usually yes.
        grandTotalOrderAmountRMB
    };
};
