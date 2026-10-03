import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MemberDashboard from './Dashboard';
import * as MemberContext from '../../contexts/MemberContext';

// Mock contexts and components that might cause issues during simple rendering
vi.mock('./Profile', () => ({ default: () => <div data-testid="mock-profile">Profile</div> }));
vi.mock('./Orders', () => ({ default: () => <div data-testid="mock-orders">Orders</div> }));
vi.mock('./DMList', () => ({ default: () => <div data-testid="mock-dms">DM List</div> }));
vi.mock('./MailSymbols', () => ({ default: () => <div data-testid="mock-mail">Mail</div> }));
vi.mock('../../components/ErrorBoundary', () => ({ default: ({ children }: any) => <div data-testid="error-boundary">{children}</div> }));

const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

describe('MemberDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    const queryClient = createTestQueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MemberDashboard />
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it('should display loading state when data is loading to prevent black screen', () => {
    vi.spyOn(MemberContext, 'useMember').mockReturnValue({
      member: null,
      isLoading: true,
      isError: false,
      logout: vi.fn(),
      refetchMember: vi.fn(),
    });

    renderComponent();
    expect(screen.getByText(/載入中/i)).toBeInTheDocument();
  });

  it('should render dashboard tabs without admin-only new product module when member is loaded', async () => {
    vi.spyOn(MemberContext, 'useMember').mockReturnValue({
      member: {
        id: 1,
        name: 'Test User',
        phone: '0912345678',
        level: 'Gold',
        points: 100,
        is_active: true,
      },
      isLoading: false,
      isError: false,
      logout: vi.fn(),
      refetchMember: vi.fn(),
    });

    renderComponent();
    
    // Ensure Error Boundary is present
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    
    // Check if the tabs label for orders exists
    await waitFor(() => {
      expect(screen.getByText(/訂單記錄/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/新品總覽/i)).not.toBeInTheDocument();
  });
});
