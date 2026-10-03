import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Typography, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api';

const { Title } = Typography;

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      message.error('無效的重設連結 (Invalid reset link)');
      navigate('/login');
    }
  }, [token, navigate]);

  const onFinish = async (values: any) => {
    if (values.password !== values.confirmPassword) {
      message.error('兩次輸入的密碼不一致 (Passwords do not match)');
      return;
    }
    
    if (!token) return;

    setLoading(true);
    try {
      await resetPassword(token, values.password);
      message.success('密碼重設成功，請使用新密碼登入 (Password reset successful)');
      navigate('/login');
    } catch (error: any) {
      console.error(error);
      message.error(error.response?.data?.detail || '重設失敗，連結可能已過期 (Reset failed)');
    } finally {
      setLoading(false);
    }
  };

  if (!token) return null;

  return (
    <div className="sl-auth">
      <div className="sl-auth__card">
        <div className="sl-auth__brand">
          <Title level={2} style={{ marginBottom: 4 }}>慢生活製造所</Title>
          <Typography.Text type="secondary">重設密碼</Typography.Text>
        </div>
        <Form
          name="reset_password"
          onFinish={onFinish}
          size="large"
          layout="vertical"
        >
          <Form.Item
            name="password"
            label="新密碼"
            rules={[
              { required: true, message: '請輸入新密碼!' },
              { min: 6, message: '密碼長度至少需 6 碼' }
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="新密碼" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="確認新密碼"
            rules={[{ required: true, message: '請確認新密碼!' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="確認新密碼" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" style={{ width: '100%' }} loading={loading}>
              確認重設
            </Button>
            <div style={{ marginTop: 10, textAlign: 'center' }}>
              <Button type="link" onClick={() => navigate('/login')}>
                返回登入
              </Button>
            </div>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default ResetPassword;
