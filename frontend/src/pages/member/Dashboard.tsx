import React, { useEffect, useState } from 'react';
import { Layout, Menu, Avatar, Typography, Tabs, Card, List, Button, Tag, Space, Descriptions, Spin } from 'antd';
import { UserOutlined, ShoppingOutlined, LogoutOutlined, GiftOutlined, NotificationOutlined, MailOutlined } from '@ant-design/icons';
import { useMember } from '../../contexts/MemberContext';
import { useNavigate, Navigate } from 'react-router-dom';
import MemberProfile from './Profile';
import MemberOrders from './Orders';
import MemberDMList from './DMList';
import MailSymbols from './MailSymbols';
import PointsStore from './PointsStore';
import ErrorBoundary from '../../components/ErrorBoundary';

const { Header, Content } = Layout;
const { Text } = Typography;

const MemberDashboard: React.FC = () => {
  const { member, isLoading, isError, logout } = useMember();
  const navigate = useNavigate();

  useEffect(() => {
    // #region debug-point B:dashboard-render
    fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"member-login-redirect",runId:"post-fix",hypothesisId:"B",location:"frontend/src/pages/member/Dashboard.tsx:render",msg:"[DEBUG] member dashboard render state",data:{isLoading,isError,hasMember:!!member,memberId:member?.id ?? null,currentPath:window.location.pathname},ts:Date.now()})}).catch(()=>{});
    // #endregion
  }, [isLoading, isError, member]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>載入中... (Loading...)</div>
        </div>
      </div>
    );
  }

  if (isError || !member) {
    return <Navigate to="/member/login" replace />;
  }

  const items = [
    { key: 'dms', label: <span><NotificationOutlined /> 新品快訊 (Promotions)</span>, children: <MemberDMList /> },
    { key: 'profile', label: <span><UserOutlined /> 個人資料 (Profile)</span>, children: <MemberProfile /> },
    { key: 'orders', label: <span><ShoppingOutlined /> 訂單記錄 (Orders)</span>, children: <MemberOrders /> },
    { key: 'mail_symbols', label: <span><MailOutlined /> 信件匣 (Mail Symbols)</span>, children: <MailSymbols /> },
    { key: 'points', label: <span><GiftOutlined /> 紅利商店 (Points Store)</span>, children: <PointsStore /> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', zIndex: 1 }}>
        <div style={{ fontSize: '22px', fontWeight: '800', color: '#531dab', letterSpacing: '1px' }}>VIP Center</div>
        <Space size="large">
          <Text strong style={{ fontSize: 16 }}>{member.name}</Text>
          <Button type="text" icon={<LogoutOutlined />} onClick={logout}>登出 (Logout)</Button>
        </Space>
      </Header>
      <Content style={{ padding: '32px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <ErrorBoundary>
          <Card bordered={false}>
             <Tabs defaultActiveKey="dms" items={items} size="large" />
          </Card>
        </ErrorBoundary>
      </Content>
    </Layout>
  );
};

export default MemberDashboard;
