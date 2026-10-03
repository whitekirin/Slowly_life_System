import React, { useState } from 'react';
import { Table, Button, Card, Space, Tag, Modal, Form, Input, Select, DatePicker, message, Upload } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdminDMs, createAdminDM, updateAdminDM, deleteAdminDM } from '../api';
import dayjs from 'dayjs';

import { useUser } from '../contexts/UserContext';
const { Option } = Select;
const { RangePicker } = DatePicker;

const AdminDMList: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_dms');
  const canEdit = hasPermission('edit_dms');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: dms, isLoading } = useQuery({
    queryKey: ['admin_dms'],
    queryFn: () => getAdminDMs(),
  });

  const createMutation = useMutation({
    mutationFn: createAdminDM,
    onSuccess: () => {
      message.success('新增 DM 成功');
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin_dms'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => updateAdminDM(data.id, data),
    onSuccess: () => {
      message.success('更新 DM 成功');
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin_dms'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAdminDM,
    onSuccess: () => {
      message.success('刪除 DM 成功');
      queryClient.invalidateQueries({ queryKey: ['admin_dms'] });
    },
  });

  const handleOpenModal = (record?: any) => {
    if (record) {
      setEditingId(record.id);
      form.setFieldsValue({
        ...record,
        valid_range: record.valid_from && record.valid_until ? [dayjs(record.valid_from), dayjs(record.valid_until)] : undefined,
      });
    } else {
      setEditingId(null);
      form.resetFields();
    }
    setIsModalOpen(true);
  };

  const handleSubmit = (values: any) => {
    const payload = {
      ...values,
      valid_from: values.valid_range ? values.valid_range[0].format('YYYY-MM-DDTHH:mm:ss') : null,
      valid_until: values.valid_range ? values.valid_range[1].format('YYYY-MM-DDTHH:mm:ss') : null,
    };
    delete payload.valid_range;

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const columns = [
    { title: '標題 (Title)', dataIndex: 'title', key: 'title' },
    { 
      title: '狀態 (Status)', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => {
        const colorMap: Record<string, string> = { draft: 'default', reviewing: 'orange', published: 'green', unpublished: 'red' };
        return <Tag color={colorMap[status]}>{status.toUpperCase()}</Tag>;
      }
    },
    { 
      title: '有效期間 (Valid Period)', 
      key: 'valid_period',
      render: (_: any, record: any) => record.valid_from ? `${dayjs(record.valid_from).format('YYYY-MM-DD')} ~ ${dayjs(record.valid_until).format('YYYY-MM-DD')}` : '永久有效'
    },
    { title: '觀看次數 (Views)', dataIndex: 'views', key: 'views' },
    { title: '點擊次數 (Clicks)', dataIndex: 'clicks', key: 'clicks' },
    {
      title: '操作 (Actions)',
      key: 'actions',
      render: (_: any, record: any) => canEdit && (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => handleOpenModal(record)} />
          <Button danger icon={<DeleteOutlined />} onClick={() => {
            Modal.confirm({
              title: '確認刪除此 DM?',
              onOk: () => deleteMutation.mutate(record.id)
            });
          }} />
        </Space>
      )
    }
  ];

  return (
    <Card title="行銷 DM 管理" extra={canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>新增 DM</Button>}>
      <Table columns={columns} dataSource={dms} rowKey="id" loading={isLoading} />
      
      <Modal
        title={editingId ? '編輯 DM' : '新增 DM'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="title" label="標題 (Title)" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="image_url" label="圖片網址 (Image URL)" rules={[{ required: true }]}>
            <Input placeholder="https://example.com/image.jpg" />
          </Form.Item>
          <Form.Item name="link" label="跳轉連結 (Target Link)">
            <Input />
          </Form.Item>
          <Form.Item name="content" label="內文 (Content)">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="status" label="狀態 (Status)" rules={[{ required: true }]} initialValue="draft">
            <Select>
              <Option value="draft">草稿 (Draft)</Option>
              <Option value="reviewing">審核中 (Reviewing)</Option>
              <Option value="published">已發布 (Published)</Option>
              <Option value="unpublished">已下架 (Unpublished)</Option>
            </Select>
          </Form.Item>
          <Form.Item name="valid_range" label="發布與下架時間 (Schedule)">
            <RangePicker showTime />
          </Form.Item>
          <Form.Item name="target_levels" label="發送對象 (Target Audience)" initialValue={['all']}>
            <Select mode="tags">
              <Option value="all">全體會員 (All)</Option>
              <Option value="Bronze">銅星 (Bronze)</Option>
              <Option value="Silver">銀星 (Silver)</Option>
              <Option value="Gold">金星 (Gold)</Option>
              <Option value="Platinum">白金 (Platinum)</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default AdminDMList;
