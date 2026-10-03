import React, { useEffect } from 'react';
import { Form, Input, Button, Card, message, Spin, Divider, Space } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUser, updateUser } from '../api';

const UserSettings: React.FC = () => {
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ['user'],
    queryFn: getUser,
  });

  const profileMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      message.success('設定已更新');
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
    onError: (error: any) => {
      if (error.response?.status !== 401) {
        console.error("Update failed:", error);
        message.error(`更新失敗: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  const passwordMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      message.success('密碼修改成功');
      passwordForm.resetFields();
    },
    onError: (error: any) => {
      if (error.response?.status !== 401) {
        message.error(error.response?.data?.detail || '密碼修改失敗');
      }
    },
  });

  useEffect(() => {
    if (user) {
      profileForm.setFieldsValue({
        full_name: user.full_name,
        email: user.email,
      });
    }
  }, [user, profileForm]);

  const onFinishProfile = (values: any) => {
    profileMutation.mutate(values);
  };

  const onFinishPassword = (values: any) => {
    passwordMutation.mutate({
      current_password: values.current_password,
      password: values.new_password,
    });
  };

  if (isLoading) return <Spin />;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 600, margin: '0 auto', display: 'flex' }}>
      <Card title="個人設定">
        <Form
          form={profileForm}
          layout="vertical"
          onFinish={onFinishProfile}
        >
          <Form.Item
            name="full_name"
            label="姓名 (Full Name)"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="email"
            label="電子郵件 (Email)"
            rules={[{ type: 'email' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={profileMutation.isPending}>
              儲存設定
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="修改密碼">
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={onFinishPassword}
        >
          <Form.Item
            name="current_password"
            label="目前密碼 (Current Password)"
            rules={[{ required: true, message: '請輸入目前密碼' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>

          <Form.Item
            name="new_password"
            label="新密碼 (New Password)"
            rules={[{ required: true, min: 6, message: '密碼長度至少需 6 碼' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label="確認新密碼 (Confirm New Password)"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '請再次輸入新密碼' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('兩次輸入的密碼不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Divider style={{ margin: '12px 0' }} />

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={passwordMutation.isPending}>
              修改密碼
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Space>
  );
};

export default UserSettings;
