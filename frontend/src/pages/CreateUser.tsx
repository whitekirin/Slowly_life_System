import React, { useState } from 'react';
import { Form, Input, Button, Card, message, Select } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { createUser } from '../api';
import { useNavigate } from 'react-router-dom';

const CreateUser: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      message.success('使用者建立成功');
      form.resetFields();
      navigate('/system-settings'); // Redirect back to system settings (user list)
    },
    onError: (error: any) => {
        const msg = error.response?.data?.detail || '建立失敗';
        message.error(msg);
    },
  });

  const onFinish = (values: any) => {
    createMutation.mutate(values);
  };

  return (
    <Card title="新增使用者" style={{ maxWidth: 600, margin: '24px auto' }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
      >
        <Form.Item
          name="full_name"
          label="姓名 (Full Name)"
          rules={[{ required: true }]}
        >
          <Input placeholder="請輸入姓名" />
        </Form.Item>

        <Form.Item
          name="employee_id"
          label="員工編號 (Employee ID)"
          rules={[{ required: true }]}
        >
          <Input placeholder="請輸入員工編號" />
        </Form.Item>

        <Form.Item
          name="department"
          label="部門 (Department)"
          rules={[{ required: true }]}
        >
           <Input placeholder="請輸入部門" />
        </Form.Item>

        <Form.Item
          name="username"
          label="帳號 (Username)"
          rules={[{ required: true }]}
        >
          <Input placeholder="請輸入登入帳號" />
        </Form.Item>
        
        <Form.Item
          name="email"
          label="電子郵件 (Email)"
          rules={[{ type: 'email' }]}
        >
          <Input placeholder="user@example.com" />
        </Form.Item>

        <Form.Item
          name="password"
          label="密碼 (Password)"
          rules={[{ required: true, min: 6, message: '密碼至少需 6 碼' }]}
        >
          <Input.Password placeholder="請設定密碼" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={createMutation.isPending} block>
            建立使用者
          </Button>
          <Button type="default" block style={{ marginTop: 8 }} onClick={() => navigate('/system-settings')}>
            返回
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default CreateUser;
