import React, { useState } from 'react';
import { Card, Tabs, Table, Tag, Button, Space, Modal, Form, InputNumber, Input, Popconfirm, Switch, Typography, message } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  getMyChangeRequests, getChangeRequestsForApproval, approveChangeRequest, rejectChangeRequest, cancelChangeRequest,
  type ChangeRequest,
} from '../api';
import { useUser } from '../contexts/UserContext';
import { PERMISSION_MODULES } from '../permissions';

const ACTION_LABEL: Record<string, string> = { edit: '修改', delete: '刪除', void: '報廢' };

const STATUS_TAG: Record<ChangeRequest['effective_status'], { color: string; text: string }> = {
  pending: { color: 'gold', text: '審核中' },
  active: { color: 'green', text: '已核准（有效）' },
  used_up: { color: 'default', text: '已用完' },
  expired: { color: 'default', text: '已過期' },
  rejected: { color: 'red', text: '已駁回' },
  cancelled: { color: 'default', text: '已取消' },
  voided: { color: 'red', text: '已核准，單據已報廢' },
};

const fmt = (t?: string | null) => (t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-');

const baseColumns = [
  { title: '編號', dataIndex: 'id', key: 'id', width: 70 },
  {
    title: '對象',
    key: 'resource',
    render: (_: unknown, r: ChangeRequest) => (r.resource_link ? <Link to={r.resource_link}>{r.resource_label}</Link> : r.resource_label),
  },
  { title: '動作', dataIndex: 'action', key: 'action', width: 70, render: (a: string) => a === 'void' ? <Tag color="red">報廢</Tag> : (ACTION_LABEL[a] || a) },
  { title: '事由', dataIndex: 'reason', key: 'reason', render: (t: string) => <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{t}</Typography.Paragraph> },
  {
    title: '附件',
    dataIndex: 'attachment_url',
    key: 'attachment_url',
    width: 80,
    render: (url?: string | null) => (url ? <a href={url} target="_blank" rel="noreferrer">查看</a> : '-'),
  },
  { title: '申請人', dataIndex: 'requester_name', key: 'requester_name', width: 100 },
  { title: '送出時間', dataIndex: 'created_at', key: 'created_at', width: 140, render: fmt },
  {
    title: '狀態',
    key: 'status',
    width: 200,
    render: (_: unknown, r: ChangeRequest) => {
      const tag = STATUS_TAG[r.effective_status] || { color: 'default', text: r.status };
      return (
        <div>
          <Tag color={tag.color}>{tag.text}</Tag>
          {r.status === 'approved' && r.action !== 'void' && (
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
              已用 {r.used_count}/{r.max_uses} 次，{fmt(r.expires_at)} 到期
            </div>
          )}
          {r.approver_name && <div style={{ fontSize: 12, color: '#8c8c8c' }}>處理人：{r.approver_name}</div>}
          {r.decision_note && <div style={{ fontSize: 12, color: '#8c8c8c' }}>意見：{r.decision_note}</div>}
        </div>
      );
    },
  },
];

const ChangeRequests: React.FC = () => {
  const { hasPermission } = useUser();
  const queryClient = useQueryClient();
  const canApproveAny = PERMISSION_MODULES.some(m => m.approve && hasPermission(m.approve));
  const invalidateOrders = () => {
    // 報廢簽呈核准／駁回／取消會改變單據狀態
    queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
    queryClient.invalidateQueries({ queryKey: ['sales_orders'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };
  const [showAllForApproval, setShowAllForApproval] = useState(false);
  const [approving, setApproving] = useState<ChangeRequest | null>(null);
  const [rejecting, setRejecting] = useState<ChangeRequest | null>(null);
  const [approveForm] = Form.useForm();
  const [rejectForm] = Form.useForm();

  const { data: mine, isLoading: mineLoading } = useQuery({ queryKey: ['change_requests', 'mine'], queryFn: () => getMyChangeRequests() });
  const { data: forApproval, isLoading: approvalLoading } = useQuery({
    queryKey: ['change_requests', 'for-approval', showAllForApproval],
    queryFn: () => getChangeRequestsForApproval(!showAllForApproval),
    enabled: canApproveAny,
  });

  const onDone = (text: string) => {
    message.success(text);
    queryClient.invalidateQueries({ queryKey: ['change_requests'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    invalidateOrders();
  };
  const onError = (error: any) => message.error(error.response?.data?.detail || '操作失敗');

  const approveMutation = useMutation({
    mutationFn: approveChangeRequest,
    onSuccess: () => { onDone('已核准'); setApproving(null); approveForm.resetFields(); },
    onError,
  });
  const rejectMutation = useMutation({
    mutationFn: rejectChangeRequest,
    onSuccess: () => { onDone('已駁回'); setRejecting(null); rejectForm.resetFields(); },
    onError,
  });
  const cancelMutation = useMutation({ mutationFn: cancelChangeRequest, onSuccess: () => onDone('已取消'), onError });

  const approvalColumns = [
    ...baseColumns,
    {
      title: '操作',
      key: 'op',
      width: 150,
      render: (_: unknown, r: ChangeRequest) => r.effective_status === 'pending' && (
        <Space>
          <Button type="primary" size="small" onClick={() => setApproving(r)}>核准</Button>
          <Button danger size="small" onClick={() => setRejecting(r)}>駁回</Button>
        </Space>
      ),
    },
  ];

  const mineColumns = [
    ...baseColumns.filter(c => c.key !== 'requester_name'),
    {
      title: '操作',
      key: 'op',
      width: 90,
      render: (_: unknown, r: ChangeRequest) => r.effective_status === 'pending' && (
        <Popconfirm title="確定取消這份簽呈？" onConfirm={() => cancelMutation.mutate(r.id)}>
          <Button size="small">取消</Button>
        </Popconfirm>
      ),
    },
  ];

  const tabs = [
    ...(canApproveAny ? [{
      key: 'approval',
      label: `待我核准${forApproval && !showAllForApproval ? `（${forApproval.length}）` : ''}`,
      children: (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Switch checked={showAllForApproval} onChange={setShowAllForApproval} />
            <span>顯示已處理的簽呈</span>
          </Space>
          <Table rowKey="id" columns={approvalColumns} dataSource={forApproval} loading={approvalLoading} scroll={{ x: 1100 }} />
        </>
      ),
    }] : []),
    {
      key: 'mine',
      label: '我送出的',
      children: <Table rowKey="id" columns={mineColumns} dataSource={mine} loading={mineLoading} scroll={{ x: 1000 }} />,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card title="簽呈">
        <Typography.Paragraph type="secondary">
          已鎖定的單據（例如「已完成」的採購單）要修改時，在該單據按「申請修改」送出簽呈，由核准人決定期限（最長 24 小時）與可修改次數。
          採購單、出貨單不能刪除，只能「申請報廢」：送出後單據凍結為「報廢審核中」，核准後正式報廢並沖回庫存與記帳，駁回則恢復。
          所有送出、核准、駁回與修改都記錄在系統日誌。
        </Typography.Paragraph>
        <Tabs items={tabs} />
      </Card>

      <Modal
        title={approving ? `核准簽呈 #${approving.id}：${ACTION_LABEL[approving.action]}${approving.resource_label}` : ''}
        open={!!approving}
        onCancel={() => setApproving(null)}
        onOk={async () => {
          const values = await approveForm.validateFields();
          if (approving) approveMutation.mutate({ id: approving.id, data: values });
        }}
        okText={approving?.action === 'void' ? '核准報廢' : '核准'}
        okButtonProps={{ danger: approving?.action === 'void' }}
        confirmLoading={approveMutation.isPending}
        destroyOnHidden
      >
        <Form form={approveForm} layout="vertical" initialValues={{ valid_hours: 24, max_uses: 1 }}>
          {approving?.action === 'void' ? (
            <Typography.Paragraph type="danger">
              核准後會立刻報廢這張單：沖回它造成的庫存與記帳（出貨單另扣回會員回饋點數），無法復原。報廢的單會留在頁面上，不能刪除。
            </Typography.Paragraph>
          ) : (
            <>
              <Form.Item name="valid_hours" label="有效時數（最長 24 小時）" rules={[{ required: true }]}>
                <InputNumber min={1} max={24} addonAfter="小時" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="max_uses" label={`可${approving ? ACTION_LABEL[approving.action] : ''}次數`} rules={[{ required: true }]}>
                <InputNumber min={1} max={20} addonAfter="次" style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
          <Form.Item name="note" label="意見（選填）">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={rejecting ? `駁回簽呈 #${rejecting.id}` : ''}
        open={!!rejecting}
        onCancel={() => setRejecting(null)}
        onOk={async () => {
          const values = await rejectForm.validateFields();
          if (rejecting) rejectMutation.mutate({ id: rejecting.id, note: values.note });
        }}
        okText="駁回"
        okButtonProps={{ danger: true }}
        confirmLoading={rejectMutation.isPending}
        destroyOnHidden
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="note" label="駁回原因（選填）">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ChangeRequests;
