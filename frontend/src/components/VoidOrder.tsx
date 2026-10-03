import React, { useState } from 'react';
import { Button, Form, Input, Modal, Tag, Tooltip, Typography, message } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { voidPurchaseOrder, voidReturnOrder, voidSalesOrder, VOID_STATUS_LABELS } from '../api';
import ChangeRequestModal from './ChangeRequestModal';

// 採購單（草稿除外，草稿直接刪除）、出貨單、退貨單不能刪除，只能報廢（backend/voiding.py）。報廢的單一直留在頁面上，只加標籤。

interface VoidFields {
  void_status?: string | null;
  void_reason?: string | null;
  void_requested_by?: string | null;
  voided_by?: string | null;
  voided_at?: string | null;
}

/** 報廢審核中／已報廢的標籤，滑過顯示原因與經手人；未報廢時不顯示。 */
export const VoidStatusTag: React.FC<{ record: VoidFields }> = ({ record }) => {
  if (!record.void_status) return null;
  const detail = [
    record.void_reason && `原因：${record.void_reason}`,
    record.void_requested_by && `申請人：${record.void_requested_by}`,
    record.voided_by && `核准人：${record.voided_by}`,
    record.voided_at && `報廢時間：${dayjs(record.voided_at).format('YYYY-MM-DD HH:mm')}`,
  ].filter(Boolean).join('\n');
  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{detail}</span>}>
      <Tag color={record.void_status === 'voided' ? 'red' : 'orange'} icon={<StopOutlined />}>
        {VOID_STATUS_LABELS[record.void_status] || record.void_status}
      </Tag>
    </Tooltip>
  );
};

/** 已報廢的列整列淡化，但不隱藏。給 Table 的 onRow 用。 */
export const voidRowStyle = (record: VoidFields): React.CSSProperties | undefined =>
  record.void_status === 'voided' ? { opacity: 0.55 } : undefined;

interface ButtonProps {
  resourceType: 'purchase_order' | 'sales_order' | 'return_order';
  record: VoidFields & { id: number };
  resourceLabel: string;
  /** 有核准權限：直接報廢 */
  canApprove: boolean;
  /** 有修改權限：送報廢簽呈 */
  canRequest: boolean;
}

const VOID_API = {
  purchase_order: { mutationFn: voidPurchaseOrder, queryKey: 'purchase_orders' },
  sales_order: { mutationFn: voidSalesOrder, queryKey: 'sales_orders' },
  return_order: { mutationFn: voidReturnOrder, queryKey: 'return_orders' },
} as const;

/** 「報廢」按鈕：主管直接報廢（填原因）；其他有修改權限的人送報廢簽呈。報廢中／已報廢的單不顯示。 */
export const VoidOrderButton: React.FC<ButtonProps> = ({ resourceType, record, resourceLabel, canApprove, canRequest }) => {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: VOID_API[resourceType].mutationFn,
    onSuccess: () => {
      message.success('已報廢，庫存與記帳已沖回');
      queryClient.invalidateQueries({ queryKey: [VOID_API[resourceType].queryKey] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setOpen(false);
      form.resetFields();
    },
    onError: (error: any) => message.error(error.response?.data?.detail || '報廢失敗'),
  });

  if (record.void_status || (!canApprove && !canRequest)) return null;

  const button = (
    <Button type="text" danger icon={<StopOutlined />} onClick={() => setOpen(true)}>
      {canApprove ? '報廢' : '申請報廢'}
    </Button>
  );

  if (!canApprove) {
    return (
      <>
        {button}
        <ChangeRequestModal
          open={open}
          onClose={() => setOpen(false)}
          resourceType={resourceType}
          resourceId={record.id}
          resourceLabel={resourceLabel}
          action="void"
        />
      </>
    );
  }

  return (
    <>
      {button}
      <Modal
        title={`報廢：${resourceLabel}`}
        open={open}
        okText="確定報廢"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        confirmLoading={mutation.isPending}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          const values = await form.validateFields();
          mutation.mutate({ id: record.id, reason: values.reason });
        }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          你有核准權限，可以直接報廢。報廢會沖回這張單造成的庫存與記帳，並記錄在系統日誌；報廢後無法復原，單據會一直留在頁面上。
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label="報廢原因" rules={[{ required: true, whitespace: true, message: '請填寫報廢原因' }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
