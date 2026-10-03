import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, Select, DatePicker, Checkbox, message, Alert, Divider } from 'antd';
import { UserOutlined, LockOutlined, MobileOutlined, MailOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { registerMember } from '../../memberApi';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

const MemberRegister: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const onFinish = async (values: any) => {
    setLoading(true);
    setError(null);
    try {
      const { confirm, agreement, ...memberData } = values;
      
      // Format date
      if (memberData.birthday) {
        memberData.birthday = memberData.birthday.format('YYYY-MM-DD');
      }
      
      await registerMember(memberData);
      
      message.success('註冊成功！請登入 (Registration Successful! Please login)');
      navigate('/member/login');
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || '註冊失敗，請稍後再試 (Registration failed)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #f9f0ff 0%, #e6f7ff 100%)', padding: '40px 24px' }}>
      <Card style={{ width: 600 }} bordered={false}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ color: '#531dab', margin: 0 }}>Join VIP</Title>
          <Text type="secondary" style={{ fontSize: 14 }}>加入專屬會員，享有頂級服務體驗！</Text>
        </div>
        
        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 24 }} />}
        
        <Form
          name="member_register"
          onFinish={onFinish}
          layout="vertical"
          size="large"
          initialValues={{ is_subscribed: true }}
        >
          <Form.Item
            name="name"
            label="姓名 (Full Name)"
            rules={[{ required: true, message: '請輸入姓名!' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="王小明" />
          </Form.Item>

          <Form.Item
            name="phone"
            label="手機號碼 (Phone Number)"
            rules={[{ required: true, message: '請輸入手機號碼!' }]}
          >
            <Input prefix={<MobileOutlined />} placeholder="0912345678" />
          </Form.Item>

          <Form.Item
            name="email"
            label="電子郵件 (Email)"
            rules={[
              { type: 'email', message: '請輸入有效的 Email!' },
              { required: true, message: '請輸入 Email!' }
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="example@gmail.com" />
          </Form.Item>
          
          <div style={{ display: 'flex', gap: '16px' }}>
            <Form.Item
              name="gender"
              label="性別 (Gender)"
              style={{ flex: 1 }}
            >
              <Select placeholder="選擇性別">
                <Option value="Male">男 (Male)</Option>
                <Option value="Female">女 (Female)</Option>
                <Option value="Other">其他 (Other)</Option>
              </Select>
            </Form.Item>

            <Form.Item
              name="birthday"
              label="生日 (Birthday)"
              style={{ flex: 1 }}
            >
              <DatePicker style={{ width: '100%' }} placeholder="選擇日期" />
            </Form.Item>
          </div>
          
          <Form.Item
            name="line_id"
            label="LINE ID"
          >
            <Input placeholder="非必填 (Optional)" />
          </Form.Item>
          
          <Form.Item
            name="address"
            label="地址 (Address)"
          >
            <Input prefix={<EnvironmentOutlined />} placeholder="預設收件地址" />
          </Form.Item>

          <Divider />

          <Form.Item
            name="password"
            label="設定密碼 (Password)"
            rules={[
              { required: true, message: '請輸入密碼!' },
              { min: 6, message: '密碼長度至少 6 碼' }
            ]}
            hasFeedback
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>

          <Form.Item
            name="confirm"
            label="確認密碼 (Confirm Password)"
            dependencies={['password']}
            hasFeedback
            rules={[
              { required: true, message: '請確認密碼!' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('兩次輸入的密碼不一致!'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>

          <Form.Item
            name="is_subscribed"
            valuePropName="checked"
          >
            <Checkbox>同意接收產品資訊與優惠活動 (Receive Marketing Info)</Checkbox>
          </Form.Item>

          <Form.Item
            name="agreement"
            valuePropName="checked"
            rules={[
              {
                validator: (_, value) =>
                  value ? Promise.resolve() : Promise.reject(new Error('請閱讀並同意服務條款')),
              },
            ]}
          >
            <Checkbox>
              我已閱讀並同意 <a href="#">服務條款</a> 與 <a href="#">隱私權政策</a>
            </Checkbox>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              註冊會員 (Register)
            </Button>
          </Form.Item>
          
          <div style={{ textAlign: 'center' }}>
            <Link to="/member/login">已有帳號？立即登入 (Login)</Link>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default MemberRegister;
