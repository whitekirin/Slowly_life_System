import React from 'react';
import { Button, Skeleton, Table } from 'antd';
import { ShoppingCartOutlined, InboxOutlined, WarningOutlined, WalletOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getDashboardStats } from '../api';
import { useUser } from '../contexts/UserContext';
import { sl } from '../theme/slowlife';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TrendPoint { month: string; sales: number; cost: number }
interface RecentOrder {
  id: number;
  order_number?: string | null;
  customer: string;
  total_amount: number;
  status: string;
  void_status?: string | null;
}

// 出貨單狀態（同出貨管理頁的用詞）
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '待出貨', cls: 'pending' },
  picking: { label: '撿貨中', cls: 'pending' },
  picked: { label: '撿貨完成', cls: 'info' },
  shipped: { label: '已出貨', cls: 'done' },
  completed: { label: '已完成', cls: 'done' },
};

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '午後好';
  return '晚安';
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface StatProps {
  icon: React.ReactNode;
  tone?: 'brown' | 'green' | 'warn';
  title: string;
  value: React.ReactNode;
  unit?: string;
  note?: React.ReactNode;
  noteTone?: 'good' | 'warn';
}

const Stat: React.FC<StatProps> = ({ icon, tone = 'brown', title, value, unit, note, noteTone }) => (
  <div className="sl-stat">
    <div className="sl-stat__head">
      <span className={`sl-stat__icon${tone === 'green' ? ' sl-stat__icon--green' : tone === 'warn' ? ' sl-stat__icon--warn' : ''}`}>{icon}</span>
      {title}
    </div>
    <div className="sl-stat__value">
      {value}
      {unit && <span className="sl-stat__unit">{unit}</span>}
    </div>
    {note && <div className={`sl-stat__note${noteTone ? ` sl-stat__note--${noteTone}` : ''}`}>{note}</div>}
  </div>
);

const Dashboard: React.FC = () => {
  const { data: stats, isLoading } = useQuery({ queryKey: ['stats'], queryFn: getDashboardStats });
  const { user } = useUser();
  const now = new Date();

  const salesData = ((stats?.sales_trend ?? []) as TrendPoint[]).map((p) => ({
    name: `${Number(p.month.slice(5))}月`,
    銷售額: p.sales,
    成本: p.cost,
  }));
  const recentOrders = (stats?.recent_orders ?? []) as RecentOrder[];

  const columns = [
    {
      title: '訂單',
      dataIndex: 'id',
      key: 'id',
      render: (id: number, r: RecentOrder) => (
        <div style={{ lineHeight: 1.45 }}>
          <div>{r.customer}</div>
          <div style={{ fontSize: 12, color: sl.textTertiary }}>{r.order_number || `SO-${id}`}</div>
        </div>
      ),
    },
    {
      title: '金額',
      dataIndex: 'total_amount',
      key: 'total_amount',
      align: 'right' as const,
      render: (val: number) => `NT$ ${Math.round(val ?? 0).toLocaleString()}`,
    },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      render: (status: string, r: RecentOrder) => {
        const b = r.void_status === 'voided'
          ? { label: '已報廢', cls: 'error' }
          : r.void_status === 'pending'
            ? { label: '報廢審核中', cls: 'warn' }
            : STATUS_BADGE[status] ?? { label: status, cls: 'info' };
        return <span className={`sl-badge sl-badge--${b.cls}`}>{b.label}</span>;
      },
    },
  ];

  const lowStock = stats?.low_stock_count ?? 0;
  const dateLine = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}  星期${WEEKDAYS[now.getDay()]}`;

  return (
    <div>
      <div className="sl-greeting">
        <div>
          <div className="sl-greeting__date">{dateLine}</div>
          <h2 className="sl-greeting__title">
            {greeting(now)}{user?.full_name ? `，${user.full_name}` : ''}。
          </h2>
          <div className="sl-greeting__sub">今天也慢慢來，把事情一件一件整理好。</div>
        </div>
        {lowStock > 0 && (
          <Link to="/products">
            <Button icon={<ArrowRightOutlined />} iconPlacement="end">先看看需要補貨的商品</Button>
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="sl-stat-grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="sl-stat" key={i}><Skeleton active paragraph={{ rows: 1 }} /></div>
          ))}
        </div>
      ) : (
        <div className="sl-stat-grid">
            <Stat
              icon={<WarningOutlined />}
              tone="warn"
              title="庫存不足"
              value={lowStock}
              unit="項"
              note={lowStock > 0 ? '低於安全庫存，建議安排補貨' : '庫存都很充足'}
              noteTone={lowStock > 0 ? 'warn' : 'good'}
            />
            <Stat icon={<ShoppingCartOutlined />} title="累計訂單" value={(stats?.total_so_count ?? 0).toLocaleString()} unit="筆" note={`採購單共 ${(stats?.total_po_count ?? 0).toLocaleString()} 筆`} />
            <Stat icon={<InboxOutlined />} tone="green" title="在庫商品" value={(stats?.total_sku ?? 0).toLocaleString()} unit="個 SKU" note="已入庫過的品項" />
            <Stat
              icon={<WalletOutlined />}
              title="庫存總值"
              value={<><span className="sl-stat__unit" style={{ marginLeft: 0, marginRight: 4 }}>NT$</span>{Math.round(stats?.total_inventory_value ?? 0).toLocaleString()}</>}
              note="以成本價計算"
            />
        </div>
      )}

      <div className="sl-dash-row">
          <div className="sl-stat" style={{ gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h3 className="sl-section-title">銷售趨勢</h3>
              <span className="sl-section-note">
                <span style={{ color: sl.chart[0] }}>●</span> 銷售額<span style={{ color: sl.chart[1], marginLeft: 14 }}>●</span> 成本<span style={{ marginLeft: 14 }}>近 7 個月・已出貨</span>
              </span>
            </div>
            <div className="sl-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="slSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={sl.chart[0]} stopOpacity={0.16} />
                      <stop offset="100%" stopColor={sl.chart[0]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={sl.divider} vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: sl.border }} tick={{ fill: sl.textSecondary, fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: sl.textTertiary, fontSize: 12 }} width={48} />
                  <Tooltip
                    contentStyle={{ background: sl.surface, border: `1px solid ${sl.border}`, borderRadius: 10, boxShadow: sl.shadow, fontSize: 13 }}
                    labelStyle={{ color: sl.text, fontWeight: 500 }}
                    formatter={(v) => `NT$ ${Number(v).toLocaleString()}`}
                  />
                  <Area type="monotone" dataKey="銷售額" stroke={sl.chart[0]} strokeWidth={2} fill="url(#slSales)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="成本" stroke={sl.chart[1]} strokeWidth={1.5} strokeDasharray="4 4" fill="transparent" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="sl-stat" style={{ gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 className="sl-section-title">近期訂單</h3>
              <Link to="/shipping" className="sl-section-note">查看全部</Link>
            </div>
            <Table
              dataSource={recentOrders}
              columns={columns}
              rowKey="id"
              pagination={false}
              size="small"
              loading={isLoading}
              locale={{ emptyText: '還沒有訂單' }}
            />
          </div>
      </div>
    </div>
  );
};

export default Dashboard;
