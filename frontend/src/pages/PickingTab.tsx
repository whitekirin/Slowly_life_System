import React, { useState } from 'react';
import { Table, Select, Tag, Typography, Image, Modal, Divider, Space, Tooltip, Checkbox, Spin, message } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPickingOrders, getPickers, getPickerMe, updatePickingStatus, updateItemPickingStatus } from '../api';
import { useUser } from '../contexts/UserContext';

// 撿貨分頁：撿貨人員只能用下拉選單改撿貨狀態，商品、數量、金額都是唯讀。
// 每項商品勾選＝已撿貨、取消勾選＝撿貨中；整單的撿貨中／撿貨完成由後端依逐項狀態自動決定，全部撿完才能選已出貨。

const allPicked = (record: any) => record.items.length > 0 && record.items.every((i: any) => i.picking_status === 'picked');

const PLATFORM_LABELS: Record<string, string> = { shopee: '蝦皮', amazon: 'Amazon', manual: '手動/其他' };

const PickingTab: React.FC = () => {
  const queryClient = useQueryClient();
  const [shipTarget, setShipTarget] = useState<any>(null);

  const { data: orders, isLoading } = useQuery({ queryKey: ['picking_orders'], queryFn: getPickingOrders });
  const { data: pickers, isLoading: isPickersLoading } = useQuery({ queryKey: ['pickers'], queryFn: getPickers });
  // 撿貨人員（含部門繼承，前端的 hasPermission 看不到）或有出貨修改權限的人才能勾撿貨、改已出貨；其他人只能看
  const { hasPermission } = useUser();
  const { data: pickerMe } = useQuery({ queryKey: ['pickers', 'me'], queryFn: getPickerMe });
  const canPick = !!pickerMe?.is_picker || hasPermission('edit_shipping');

  const statusMutation = useMutation({
    mutationFn: updatePickingStatus,
    onSuccess: (_data, variables) => {
      message.success(variables.status === 'shipped' ? '已改為已出貨' : '撿貨狀態已更新');
      setShipTarget(null);
      queryClient.invalidateQueries({ queryKey: ['picking_orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales_orders'] });
    },
    onError: (error: any) => {
      message.error(`更新失敗: ${error.response?.data?.detail || error.message}`);
    },
  });

  const itemMutation = useMutation({
    mutationFn: updateItemPickingStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['picking_orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales_orders'] });
    },
    onError: (error: any) => {
      message.error(`更新失敗: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleStatusChange = (record: any, status: string) => {
    // 已出貨會記收入且無法改回，多一步確認
    if (status === 'shipped') {
      setShipTarget(record);
      return;
    }
    statusMutation.mutate({ id: record.id, status });
  };

  const columns = [
    { title: '出貨單號', dataIndex: 'order_number', key: 'order_number', render: (text: string, record: any) => text || `SO-${record.id}` },
    { title: '平台', dataIndex: 'platform', key: 'platform', render: (v: string) => <Tag>{PLATFORM_LABELS[v] || v}</Tag> },
    { title: '客戶編號', dataIndex: 'customer_id', key: 'customer_id' },
    {
      title: '出貨商品（勾選＝已撿貨）',
      key: 'items',
      render: (_: unknown, record: any) => (
        <Space direction="vertical" size={4}>
          {record.items.map((item: any) => (
            <Space key={item.id} size={8}>
              <Checkbox
                checked={item.picking_status === 'picked'}
                disabled={!canPick || (itemMutation.isPending && itemMutation.variables?.itemId === item.id)}
                onChange={(e) => itemMutation.mutate({ orderId: record.id, itemId: item.id, status: e.target.checked ? 'picked' : 'picking' })}
              >
                <Typography.Text delete={item.picking_status === 'picked'} type={item.picking_status === 'picked' ? 'secondary' : undefined}>
                  {item.product_name}{item.sku ? `（${item.sku}）` : ''} × {item.quantity}
                </Typography.Text>
              </Checkbox>
              {itemMutation.isPending && itemMutation.variables?.itemId === item.id && <Spin size="small" />}
            </Space>
          ))}
        </Space>
      ),
    },
    { title: '總數量', dataIndex: 'total_quantity', key: 'total_quantity' },
    { title: '總金額', dataIndex: 'total_amount', key: 'total_amount', render: (val: number) => `$${val}` },
    {
      title: '蝦皮 QRcode',
      dataIndex: 'shopee_qrcode_image',
      key: 'shopee_qrcode_image',
      render: (v: string, record: any) => record.platform !== 'shopee'
        ? '-'
        : v ? <Image src={v} width={60} /> : <Typography.Text type="warning">未上傳</Typography.Text>,
    },
    { title: '出貨人', dataIndex: 'shipped_by', key: 'shipped_by', render: (v: string) => v || '-' },
    {
      title: '出貨單狀態',
      key: 'status',
      render: (_: unknown, record: any) => {
        const done = record.items.filter((i: any) => i.picking_status === 'picked').length;
        return (
          <Space direction="vertical" size={4}>
            <Tooltip title={allPicked(record) ? undefined : '所有商品都已撿貨後才能改為已出貨'}>
              <Select
                value={record.status}
                style={{ width: 120 }}
                disabled={!canPick}
                options={[
                  { value: 'picking', label: '撿貨中', disabled: true },
                  { value: 'picked', label: '撿貨完成', disabled: true },
                  { value: 'shipped', label: '已出貨', disabled: !allPicked(record) },
                ]}
                loading={statusMutation.isPending && statusMutation.variables?.id === record.id}
                onChange={(status: string) => handleStatusChange(record, status)}
              />
            </Tooltip>
            <Typography.Text type="secondary">已撿 {done}/{record.items.length} 項</Typography.Text>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Table
        dataSource={orders}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: '目前沒有需要撿貨的出貨單' }}
      />

      <Divider titlePlacement="left">撿貨人員名單</Divider>
      <Typography.Paragraph type="secondary">
        建立出貨單時，以下撿貨人員與所有 admin 會收到 LINE 通知（需先綁定 LINE）。
        要新增撿貨人員：到「系統設定 → 部門管理」把部門的預設權限加上「撿貨人員」，該部門成員即生效。
      </Typography.Paragraph>
      <Table
        dataSource={pickers}
        rowKey="id"
        loading={isPickersLoading}
        pagination={false}
        locale={{ emptyText: '尚未設定撿貨人員' }}
        columns={[
          { title: '姓名', dataIndex: 'full_name', key: 'full_name', render: (v: string, r: any) => v || r.username },
          { title: '帳號', dataIndex: 'username', key: 'username' },
          { title: '部門', dataIndex: 'department', key: 'department', render: (v: string) => v || '-' },
          {
            title: 'LINE',
            key: 'line',
            render: (_: unknown, r: any) => r.line_bound
              ? <Tag color="green">已綁定{r.line_display_name ? `（${r.line_display_name}）` : ''}</Tag>
              : <Tag>未綁定，收不到通知</Tag>
          },
        ]}
      />

      <Modal
        title="確認改為已出貨？"
        open={!!shipTarget}
        okText="確認出貨"
        cancelText="取消"
        confirmLoading={statusMutation.isPending}
        onOk={() => shipTarget && statusMutation.mutate({ id: shipTarget.id, status: 'shipped' })}
        onCancel={() => setShipTarget(null)}
      >
        出貨單 {shipTarget?.order_number || `SO-${shipTarget?.id}`} 改為已出貨後會自動記一筆收入，且無法再改回撿貨狀態。
      </Modal>
    </>
  );
};

export default PickingTab;
