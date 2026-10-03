import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MemberNewProducts from './MemberNewProducts';
import * as api from '../api';

vi.mock('../api', () => ({
  getAdminNewProductsOverview: vi.fn(),
  getAdminNewProductsList: vi.fn(),
  getAdminNewProductBatches: vi.fn(),
  exportAdminNewProducts: vi.fn(),
}));

vi.mock('recharts', () => {
  const Mock = ({ children }: any) => <div>{children}</div>;
  return {
    ResponsiveContainer: Mock,
    PieChart: Mock,
    Pie: Mock,
    Cell: Mock,
    Tooltip: Mock,
    Legend: Mock,
    LineChart: Mock,
    Line: Mock,
    BarChart: Mock,
    Bar: Mock,
    XAxis: Mock,
    YAxis: Mock,
    CartesianGrid: Mock,
  };
});

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

describe('MemberNewProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders overview panel and both product lists in admin system', async () => {
    vi.mocked(api.getAdminNewProductsOverview).mockResolvedValue({
      current_month_label: '2026年08月',
      total_online_products: 2,
      current_month_total: 1,
      total_sales_volume: 12,
      total_in_stock_products: 2,
      average_sales_volume: 6,
      category_options: ['服飾'],
      category_breakdown: [{ category_name: '服飾', product_count: 2 }],
      monthly_launch_trend: [{ month: '2026-08', product_count: 1, sales_volume: 5 }],
      top_selling_products: [{ product_name: '主打新品', sales_volume: 5 }],
    });

    vi.mocked(api.getAdminNewProductBatches).mockResolvedValue([
      {
        batch_id: 101,
        published_at: '2026-08-01T10:00:00',
        created_at: '2026-08-01T09:00:00',
        created_by_name: '上架專員',
        product_count: 1,
        total_quantity: 3,
        items: [
          { product_id: 1, product_sku: 'SKU-001', product_name: '主打新品', category_name: '服飾', quantity: 3 },
        ],
      },
    ]);

    vi.mocked(api.getAdminNewProductsList)
      .mockResolvedValueOnce({
        scope: 'current_month',
        current_month_label: '2026年08月',
        total: 1,
        page: 1,
        page_size: 10,
        total_pages: 1,
        items: [
          {
            product_id: 1,
            product_sku: 'SKU-001',
            product_name: '主打新品',
            category_name: '服飾',
            sales_price: 999,
            stock_quantity: 20,
            stock_status: '現貨充足',
            batch_id: 101,
            first_published_at: '2026-08-01T10:00:00',
            last_published_at: '2026-08-01T10:00:00',
            sales_volume: 5,
            purchase_url: 'https://example.com/a',
          },
        ],
      })
      .mockResolvedValueOnce({
        scope: 'all',
        current_month_label: '2026年08月',
        total: 2,
        page: 1,
        page_size: 10,
        total_pages: 1,
        items: [
          {
            product_id: 1,
            product_sku: 'SKU-001',
            product_name: '主打新品',
            category_name: '服飾',
            sales_price: 999,
            stock_quantity: 20,
            stock_status: '現貨充足',
            batch_id: 101,
            first_published_at: '2026-08-01T10:00:00',
            last_published_at: '2026-08-01T10:00:00',
            sales_volume: 5,
            purchase_url: 'https://example.com/a',
          },
          {
            product_id: 2,
            product_sku: 'SKU-002',
            product_name: '歷史新品',
            category_name: '服飾',
            sales_price: 899,
            stock_quantity: 12,
            stock_status: '現貨充足',
            batch_id: 88,
            first_published_at: '2026-07-20T10:00:00',
            last_published_at: '2026-07-20T10:00:00',
            sales_volume: 7,
            purchase_url: 'https://example.com/b',
          },
        ],
      });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <MemberNewProducts />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('累計上線新品總覽面板')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(api.getAdminNewProductsList).toHaveBeenCalledTimes(2);
    });

    expect(screen.getAllByText(/上線新品清單/).length).toBeGreaterThan(0);
    expect(screen.getByText('累計上線新品完整清單')).toBeInTheDocument();
    expect(api.getAdminNewProductsOverview).toHaveBeenCalledTimes(1);

    // 已上線批次卡片與商品列上的批次標籤
    expect(screen.getByText('已上線批次')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('上架專員')).toBeInTheDocument();
    });
    expect(screen.getAllByText('#101').length).toBeGreaterThan(1);
    expect(screen.getAllByText('#88').length).toBeGreaterThan(0);
  });
});
