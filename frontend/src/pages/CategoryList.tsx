import React, { useState } from 'react';
import { Table, Button, Modal, Form, Input, message, Popconfirm, Typography, Space } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCategories, createCategory, deleteCategory } from '../api';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

import { useUser } from '../contexts/UserContext';
const { Title } = Typography;

const CategoryList: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_categories');
  const canEdit = hasPermission('edit_categories');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: categories, isLoading } = useQuery({ queryKey: ['categories'], queryFn: getCategories });

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      message.success('類別建立成功');
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error: any) => {
        const msg = error.response?.data?.detail || '建立失敗';
        message.error(msg);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      message.success('類別刪除成功');
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error: any) => {
        const msg = error.response?.data?.detail || '刪除失敗';
        message.error(msg);
    }
  });

  const handleOk = async () => {
    try {
        const values = await form.validateFields();
        createMutation.mutate(values);
    } catch (error) {
        console.error("Validation Failed:", error);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '類別名稱', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
        title: '操作',
        key: 'action',
        render: (_: unknown, record: any) => canEdit && (
            <Popconfirm title="確定要刪除嗎？" onConfirm={() => deleteMutation.mutate(record.id)}>
                <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
        )
    }
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div className="sl-page-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, alignItems: 'center' }}>
        <Title level={2} style={{ margin: 0 }}>商品類別管理</Title>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>新增類別</Button>}
      </div>
      
      <Table 
        dataSource={categories} 
        columns={columns} 
        rowKey="id" 
        loading={isLoading} 
        pagination={{ pageSize: 5 }}
      />

      <Modal 
        title="新增類別" 
        open={isModalOpen} 
        onOk={handleOk} 
        onCancel={() => setIsModalOpen(false)}
        okText="建立"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
            <Form.Item name="name" label="類別名稱" rules={[{ required: true, message: '請輸入類別名稱' }]}>
                <Input placeholder="例如: 上衣 / 褲子" />
            </Form.Item>
            <Form.Item name="description" label="描述">
                <Input.TextArea placeholder="備註..." />
            </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CategoryList;
