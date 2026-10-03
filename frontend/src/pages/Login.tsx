import React, { useState } from 'react';
import { Form, Input, Button, Typography, message, Modal } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { login, updateUser, forgotPassword } from '../api';

const { Title } = Typography;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('username', values.username);
      formData.append('password', values.password);
      
      const data = await login(formData);
      // Set token immediately so we can use it for subsequent requests
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));

      if (data.user.force_password_change) {
          setLoginPassword(values.password);
          setIsPasswordModalOpen(true);
          setLoading(false);
          return;
      }

      message.success('登入成功');
      navigate('/');
      window.location.reload(); // Reload to update auth state in App
    } catch (error) {
      console.error(error);
      message.error('登入失敗，請檢查帳號密碼');
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
      if (!newPassword || newPassword.length < 6) {
          message.error("密碼長度至少需 6 碼");
          return;
      }
      if (newPassword !== confirmPassword) {
          message.error("兩次輸入的密碼不一致");
          return;
      }
      setChangePasswordLoading(true);
      try {
          await updateUser({
              current_password: loginPassword,
              password: newPassword,
              force_password_change: false
          });
          message.success("密碼修改成功，請繼續使用");
          setIsPasswordModalOpen(false);
          navigate('/');
          window.location.reload();
      } catch (error) {
          message.error("密碼修改失敗");
      } finally {
          setChangePasswordLoading(false);
      }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail) {
      message.error("請輸入電子信箱");
      return;
    }
    // Simple email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(forgotEmail)) {
      message.error("請輸入有效的電子信箱格式");
      return;
    }

    setForgotLoading(true);
    try {
      await forgotPassword(forgotEmail);
      message.success("重設密碼郵件已發送，請檢查您的信箱 (Email sent)");
      setIsForgotModalOpen(false);
      setForgotEmail('');
    } catch (error: any) {
      console.error(error);
      message.error(error.response?.data?.detail || "發送失敗，請稍後再試");
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="sl-auth">
      <div className="sl-auth__card">
        <div className="sl-auth__brand">
          <Title level={2} style={{ marginBottom: 4 }}>慢生活製造所</Title>
          <Typography.Text type="secondary">電商管理 · 員工登入</Typography.Text>
          <div className="sl-auth__slogan">慢下來，好好生活。</div>
        </div>
        <Form
          name="login"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '請輸入使用者名稱!' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="使用者名稱" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: '請輸入密碼!' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密碼" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" style={{ width: '100%' }} loading={loading}>
              登入
            </Button>
            <div style={{ marginTop: 10, textAlign: 'center' }}>
              <Button type="link" onClick={() => setIsForgotModalOpen(true)}>
                忘記密碼？
              </Button>
            </div>
          </Form.Item>
        </Form>
      </div>

      {/* Force Change Password Modal */}
      <Modal
        title="請修改密碼"
        open={isPasswordModalOpen}
        onOk={handleChangePassword}
        onCancel={() => {}} // Force change, cannot cancel
        confirmLoading={changePasswordLoading}
        closable={false}
        maskClosable={false}
      >
        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">為了您的帳戶安全，請修改預設密碼。</Typography.Text>
        </div>
        <Input.Password
          placeholder="新密碼"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <Input.Password
          placeholder="確認新密碼"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </Modal>

      {/* Forgot Password Modal */}
      <Modal
        title="忘記密碼"
        open={isForgotModalOpen}
        onOk={handleForgotPassword}
        onCancel={() => setIsForgotModalOpen(false)}
        confirmLoading={forgotLoading}
        okText="寄送重設信"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <Typography.Text>請輸入您的註冊信箱，我們將發送重設密碼連結給您。</Typography.Text>
        </div>
        <Input
          placeholder="電子信箱"
          value={forgotEmail}
          onChange={(e) => setForgotEmail(e.target.value)}
          type="email"
        />
      </Modal>
    </div>
  );
};

export default Login;