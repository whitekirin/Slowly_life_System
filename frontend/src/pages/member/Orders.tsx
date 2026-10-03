import React from 'react';
import { Table, Tag, Button, Spin, Empty } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getMemberOrders } from '../../memberApi';
import dayjs from 'dayjs';

const MemberOrders: React.FC = () => {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['member_orders'],
    queryFn: getMemberOrders,
  });

  const columns = [
    {
      title: '訂單編號 (Order #)',
      dataIndex: 'order_number',
      key: 'order_number',
    },
    {
      title: '日期 (Date)',
      dataIndex: 'order_date',
      key: 'order_date',
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '狀態 (Status)',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        let color = 'blue';
        if (status === 'completed') color = 'green';
        if (status === 'cancelled') color = 'red';
        if (status === 'shipped') color = 'geekblue';
        return <Tag color={color}>{status.toUpperCase()}</Tag>;
      }
    },
    {
      title: '總金額 (Amount)',
      dataIndex: 'total_amount',
      key: 'total_amount',
      render: (amount: number) => `$${amount.toLocaleString()}`,
    },
    {
      title: '獲得點數 (Earned Points)',
      dataIndex: 'earned_points',
      key: 'earned_points',
      render: (points: number) => <Tag color="gold">+{points} pts</Tag>,
    },
    {
      title: '動作 (Action)',
      key: 'action',
      render: (_: any, record: any) => (
        <Button size="small" type="link">檢視詳情 (Details)</Button>
      ),
    },
  ];

  if (isLoading) return <div style={{ textAlign: 'center', padding: 50 }}><Spin size="large" /></div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3>我的訂單 (My Orders)</h3>
      </div>
      
      {!orders || orders.length === 0 ? (
        <Empty description="尚無訂單記錄 (No orders yet)" />
      ) : (
        <Table 
          columns={columns} 
          dataSource={orders} 
          rowKey="id" 
          pagination={{ pageSize: 10 }}
        />
      )}
    </div>
  );
};

export default MemberOrders;
