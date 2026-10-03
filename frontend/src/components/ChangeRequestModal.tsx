import React, { useState } from 'react';
import { Modal, Form, Input, Upload, Button, message, Typography } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createChangeRequest, UPLOAD_URL, type ChangeRequestAction } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  resourceType: string;
  resourceId: number;
  resourceLabel: string;
  /** edit＝申請修改已鎖定的單；void＝申請報廢 */
  action: ChangeRequestAction;
}

const TEXT: Record<string, { title: string; hint: string; placeholder: string }> = {
  edit: {
    title: '申請修改',
    hint: '核准後會得到只限這張單的臨時權限，期限與可用次數由核准人決定。送出、核准與之後的修改都會記錄在系統日誌。',
    placeholder: '說明要修改的原因與內容',
  },
  void: {
    title: '申請報廢',
    hint: '送出後這張單會標示「報廢審核中」並凍結，不能修改；主管核准後正式報廢（沖回庫存與記帳），駁回則恢復。報廢的單會一直留在頁面上，不能刪除。',
    placeholder: '說明報廢的原因',
  },
};

// 送簽呈：申請修改一張已鎖定的單，或申請報廢。事由必填，附件（紙本簽呈掃描檔）選填。
const ChangeRequestModal: React.FC<Props> = ({ open, onClose, resourceType, resourceId, resourceLabel, action }) => {
  const text = TEXT[action] || TEXT.edit;
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createChangeRequest,
    onSuccess: () => {
      message.success('簽呈已送出，核准後會收到通知');
      queryClient.invalidateQueries({ queryKey: ['change_requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales_orders'] });
      handleClose();
    },
    onError: (error: any) => message.error(error.response?.data?.detail || '送出失敗'),
  });

  const handleClose = () => {
    form.resetFields();
    setFileList([]);
    onClose();
  };

  const uploading = fileList.some(f => f.status === 'uploading');

  const handleOk = async () => {
    const values = await form.validateFields();
    const uploaded = fileList.find(f => f.status === 'done');
    mutation.mutate({
      resource_type: resourceType,
      resource_id: resourceId,
      action,
      reason: values.reason,
      attachment_url: uploaded?.response?.url,
    });
  };

  return (
    <Modal
      title={`送簽呈（${text.title}）：${resourceLabel}`}
      open={open}
      onOk={handleOk}
      onCancel={handleClose}
      okText="送出簽呈"
      cancelText="取消"
      confirmLoading={mutation.isPending}
      okButtonProps={{ disabled: uploading }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{text.hint}</Typography.Paragraph>
      <Form form={form} layout="vertical">
        <Form.Item name="reason" label="事由" rules={[{ required: true, whitespace: true, message: '請填寫事由' }]}>
          <Input.TextArea rows={4} placeholder={text.placeholder} />
        </Form.Item>
        <Form.Item label="簽呈附件（選填，圖片或 PDF）">
          <Upload
            action={UPLOAD_URL}
            accept="image/*,.pdf"
            maxCount={1}
            fileList={fileList}
            onChange={({ file, fileList: next }) => {
              setFileList(next);
              if (file.status === 'error') message.error('附件上傳失敗，請稍後再試');
            }}
          >
            <Button icon={<UploadOutlined />}>上傳附件</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ChangeRequestModal;
