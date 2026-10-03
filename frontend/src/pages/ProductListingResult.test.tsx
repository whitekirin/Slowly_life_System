import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductListingResult from './ProductListingResult';
import * as api from '../api';

vi.mock('../contexts/UserContext', () => ({
    useUser: () => ({ hasPermission: () => true }),
}));

vi.mock('../api', () => ({
    getProductListingBatch: vi.fn(),
    publishProductListing: vi.fn(),
    archiveProductListing: vi.fn(),
}));

const createTestQueryClient = () => new QueryClient({
    defaultOptions: { queries: { retry: false } },
});

describe('ProductListingResult', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderComponent = (batchId = '1') => {
        const queryClient = createTestQueryClient();
        return render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[`/product-listing-result/${batchId}`]}>
                    <Routes>
                        <Route path="/product-listing-result/:batchId" element={<ProductListingResult />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
    };

    it('1. should render empty data correctly', async () => {
        vi.mocked(api.getProductListingBatch).mockResolvedValueOnce({
            id: 1,
            created_at: '2026-04-25T10:00:00',
            created_by_name: 'Test User',
            status: 'draft',
            published_at: null,
            archived_at: null,
            items: []
        });

        renderComponent();
        
        await waitFor(() => {
            expect(screen.getByText(/上架批次明細/i)).toBeInTheDocument();
            // antd Empty component default text in english is 'No data'
            expect(document.querySelector('.ant-empty')).toBeInTheDocument();
        });
    });

    it('2. should render single data correctly', async () => {
        vi.mocked(api.getProductListingBatch).mockResolvedValueOnce({
            id: 2,
            created_at: '2026-04-25T10:00:00',
            created_by_name: 'Test User',
            status: 'published',
            published_at: '2026-04-25T10:05:00',
            archived_at: null,
            items: [
                {
                    id: 101,
                    product_sku: 'SKU-001',
                    product_name: '測試商品A',
                    sales_price: 100,
                    stock_quantity: 50,
                    quantity: 10
                }
            ]
        });

        renderComponent('2');
        
        await waitFor(() => {
            expect(screen.getByText('SKU-001')).toBeInTheDocument();
            expect(screen.getByText('測試商品A')).toBeInTheDocument();
        });
    });

    it('3. should handle 5000 items (full load) correctly', async () => {
        const items = Array.from({ length: 5000 }, (_, i) => ({
            id: i + 1,
            product_sku: `SKU-${i + 1}`,
            product_name: `商品-${i + 1}`,
            sales_price: 100,
            stock_quantity: 10,
            quantity: 1
        }));

        vi.mocked(api.getProductListingBatch).mockResolvedValueOnce({
            id: 3,
            created_at: '2026-04-25T10:00:00',
            created_by_name: 'Test User',
            status: 'draft',
            published_at: null,
            archived_at: null,
            items
        });

        renderComponent('3');
        
        await waitFor(() => {
            expect(screen.getByText('SKU-1')).toBeInTheDocument();
            expect(screen.getByText('SKU-50')).toBeInTheDocument(); // Assuming 50 items per page
        });
    });

    it('4. should show error state on insufficient permissions (403)', async () => {
        vi.mocked(api.getProductListingBatch).mockRejectedValueOnce({
            response: { status: 403 }
        });

        renderComponent('4');
        
        await waitFor(() => {
            expect(screen.getByText('發生錯誤')).toBeInTheDocument();
            expect(screen.getByText(/無法取得上架批次資料，或是您沒有檢視權限/i)).toBeInTheDocument();
        });
    });
});
