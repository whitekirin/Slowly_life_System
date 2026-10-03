/**
 * Import Cost Calculation System
 * 
 * Provides functionality to calculate total import cost in NTD based on:
 * - Order Amount (CNY)
 * - Exchange Rate
 * - Shipping Fee (NTD)
 */

interface CalculationInput {
    orderAmountCNY: number;
    exchangeRate: number;
    shippingFeeNTD: number;
}

interface CalculationResult {
    totalCostNTD: number;
    timestamp: string;
    inputs: CalculationInput;
}

/**
 * Validates the input parameters.
 * Throws error if validation fails.
 */
const validateInput = (input: CalculationInput): void => {
    const { orderAmountCNY, exchangeRate, shippingFeeNTD } = input;

    // Check if inputs are numbers
    if (typeof orderAmountCNY !== 'number' || typeof exchangeRate !== 'number' || typeof shippingFeeNTD !== 'number') {
        throw new Error("Invalid input: All parameters must be numbers.");
    }

    // Check for negative values
    if (orderAmountCNY < 0) {
        throw new Error("Invalid input: Order Amount (CNY) cannot be negative.");
    }
    if (shippingFeeNTD < 0) {
        throw new Error("Invalid input: Shipping Fee (NTD) cannot be negative.");
    }

    // Check Exchange Rate (Must be > 0)
    if (exchangeRate <= 0) {
        throw new Error("Invalid input: Exchange Rate must be greater than 0.");
    }
};

/**
 * Logs the calculation details for audit purposes.
 */
const logCalculation = (result: CalculationResult): void => {
    console.log(`[Audit Log] ${result.timestamp} - Calculation Performed:`, JSON.stringify({
        inputs: result.inputs,
        output: result.totalCostNTD
    }));
};

/**
 * Calculates the Total Import Cost (NTD).
 * 
 * Formula: (Order Amount (CNY) * Exchange Rate) + Shipping Fee (NTD)
 * Result is rounded to 2 decimal places.
 * 
 * @param orderAmountCNY - Total order amount in Chinese Yuan
 * @param exchangeRate - Exchange rate from CNY to NTD
 * @param shippingFeeNTD - Total shipping fee in New Taiwan Dollar
 * @returns Total Cost in NTD (rounded to 2 decimals)
 */
export const calculateImportCost = (
    orderAmountCNY: number, 
    exchangeRate: number, 
    shippingFeeNTD: number
): number => {
    const input: CalculationInput = { orderAmountCNY, exchangeRate, shippingFeeNTD };

    // 1. Validate Input
    validateInput(input);

    // 2. Perform Calculation
    // Step 1: Convert Order Amount to NTD
    const orderAmountNTD = orderAmountCNY * exchangeRate;
    
    // Step 2: Add Shipping Fee
    const rawTotalCost = orderAmountNTD + shippingFeeNTD;

    // 3. Round to 2 decimal places
    const totalCostNTD = Math.round(rawTotalCost * 100) / 100;

    // 4. Log for Audit
    logCalculation({
        totalCostNTD,
        timestamp: new Date().toISOString(),
        inputs: input
    });

    return totalCostNTD;
};
