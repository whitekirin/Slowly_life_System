import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message, Alert } from 'antd';
import { UserOutlined, LockOutlined, MobileOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { loginMember } from '../../memberApi';
import { useQueryClient } from '@tanstack/react-query';

const { Title, Text } = Typography;

const MemberLogin: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onFinish = async (values: any) => {
    setLoading(true);
    setError(null);
    try {
      // #region debug-point A:submit-start
      fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"member-login-redirect",runId:"post-fix",hypothesisId:"A",location:"frontend/src/pages/member/Login.tsx:onFinish:start",msg:"[DEBUG] member login submit started",data:{username:values.username,hasPassword:!!values.password,currentPath:window.location.pathname},ts:Date.now()})}).catch(()=>{});
      // #endregion
      const formData = new FormData();
      formData.append('username', values.username);
      formData.append('password', values.password);
      
      const data = await loginMember(formData);
      // #region debug-point A:api-success
      fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"member-login-redirect",runId:"post-fix",hypothesisId:"A",location:"frontend/src/pages/member/Login.tsx:onFinish:success",msg:"[DEBUG] member login api success",data:{hasAccessToken:!!data?.access_token,hasMember:!!data?.member,memberId:data?.member?.id,memberName:data?.member?.name},ts:Date.now()})}).catch(()=>{});
      // #endregion
      
      localStorage.setItem('member_token', data.access_token);
      localStorage.setItem('member', JSON.stringify(data.member));
      queryClient.setQueryData(['member'], data.member);
      window.dispatchEvent(new Event('member-auth-changed'));
      // #region debug-point B:after-storage
      fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"member-login-redirect",runId:"post-fix",hypothesisId:"B",location:"frontend/src/pages/member/Login.tsx:onFinish:after-storage",msg:"[DEBUG] member login stored auth payload",data:{storedToken:!!localStorage.getItem('member_token'),storedMember:!!localStorage.getItem('member'),cachedMember:!!queryClient.getQueryData(['member']),navigateTarget:"/member/dashboard"},ts:Date.now()})}).catch(()=>{});
      // #endregion
      
      message.success('登入成功 (Login Successful)');
      queryClient.invalidateQueries({ queryKey: ['member'] });
      // #region debug-point B:before-navigate
      fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"member-login-redirect",runId:"post-fix",hypothesisId:"B",location:"frontend/src/pages/member/Login.tsx:onFinish:before-navigate",msg:"[DEBUG] member login navigating to dashboard",data:{currentPath:window.location.pathname},ts:Date.now()})}).catch(()=>{});
      // #endregion
      navigate('/member/dashboard', { replace: true });
    } catch (err: any) {
      // #region debug-point D:login-error
      fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"member-login-redirect",runId:"post-fix",hypothesisId:"D",location:"frontend/src/pages/member/Login.tsx:onFinish:error",msg:"[DEBUG] member login failed",data:{status:err?.response?.status,detail:err?.response?.data?.detail ?? err?.message ?? "unknown"},ts:Date.now()})}).catch(()=>{});
      // #endregion
      setError(err.response?.data?.detail || '登入失敗，請檢查帳號密碼 (Login failed)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #f9f0ff 0%, #e6f7ff 100%)' }}>
      <Card style={{ width: 400 }} bordered={false}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ color: '#531dab', margin: 0 }}>VIP Login</Title>
          <Text type="secondary" style={{ fontSize: 14 }}>歡迎回來！請輸入您的專屬帳號</Text>
        </div>
        
        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 24 }} />}
        
        <Form
          name="member_login"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '請輸入手機號碼或 Email!' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="手機號碼 / Email" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '請輸入密碼!' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密碼" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登入 (Login)
            </Button>
          </Form.Item>
          
          <div style={{ textAlign: 'center' }}>
            <Link to="/member/register">還沒有帳號？立即註冊 (Register)</Link>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default MemberLogin;
