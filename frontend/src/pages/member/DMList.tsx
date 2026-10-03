import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Typography, Spin, Empty, Badge, Tag, Button, message } from 'antd';
import { HeartOutlined, HeartFilled, LinkOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMemberDMs, toggleDMFavorite, trackDMView, trackDMClick, getMemberDMFavorites } from '../../memberApi';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

const MemberDMList: React.FC = () => {
  const queryClient = useQueryClient();
  const [wsConnected, setWsConnected] = useState(false);

  const { data: dms, isLoading } = useQuery({
    queryKey: ['member_dms'],
    queryFn: getMemberDMs,
    staleTime: 0, // ensure fresh data when invalidated
  });

  const { data: favorites = [] } = useQuery({
    queryKey: ['member_favorites'],
    queryFn: getMemberDMFavorites,
  });

  const favoriteIds = favorites.map((f: any) => f.id);

  const toggleFavMutation = useMutation({
    mutationFn: toggleDMFavorite,
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['member_favorites'] });
      message.success(res.action === 'added' ? '已加入收藏' : '已取消收藏');
    }
  });

  useEffect(() => {
    // WebSocket for real-time DM updates
    const ws = new WebSocket('ws://localhost:8000/dms/ws');
    
    ws.onopen = () => {
      console.log('WebSocket connected for DM updates');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received WS message:', message);
        if (['NEW_DM', 'UPDATE_DM', 'DELETE_DM'].includes(message.type)) {
          // Invalidate cache to refetch DMs within 5s (React Query does this immediately)
          queryClient.invalidateQueries({ queryKey: ['member_dms'] });
        }
      } catch (e) {
        console.error('Error parsing WS message', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [queryClient]);

  // Track views when component mounts and DMs are loaded
  useEffect(() => {
    if (dms && dms.length > 0) {
      // In a real scenario, use IntersectionObserver to track visible DMs
      // Here we just track all loaded active DMs as viewed for simplicity
      dms.forEach((dm: any) => trackDMView(dm.id));
    }
  }, [dms]);

  const handleDMClick = (dm: any) => {
    trackDMClick(dm.id);
    if (dm.link) {
      window.open(dm.link, '_blank');
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px 0' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>載入最新優惠快訊中...</div>
      </div>
    );
  }

  if (!dms || dms.length === 0) {
    return <Empty description="目前沒有最新的優惠快訊" style={{ margin: '50px 0' }} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>
          新品快訊與專屬優惠 (Latest Promotions)
          {wsConnected && <Badge status="success" style={{ marginLeft: 8 }} title="即時同步中" />}
        </Title>
      </div>

      <Row gutter={[24, 24]}>
        {dms.map((dm: any) => (
          <Col xs={24} sm={12} md={8} lg={8} key={dm.id}>
            <Card
              hoverable
              cover={
                <div style={{ position: 'relative', height: 200, overflow: 'hidden' }}>
                  <img alt={dm.title} src={dm.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onClick={() => handleDMClick(dm)} />
                  <Button 
                    type="text" 
                    icon={favoriteIds.includes(dm.id) ? <HeartFilled style={{ color: '#ff4d4f', fontSize: 20 }} /> : <HeartOutlined style={{ color: '#fff', fontSize: 20 }} />} 
                    style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.3)', borderRadius: '50%' }}
                    onClick={(e) => { e.stopPropagation(); toggleFavMutation.mutate(dm.id); }}
                  />
                </div>
              }
              actions={[
                <Button type="link" icon={<LinkOutlined />} onClick={() => handleDMClick(dm)}>了解更多 (Details)</Button>
              ]}
              style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
              bodyStyle={{ flex: 1 }}
            >
              <Card.Meta 
                title={<span style={{ fontSize: 18, whiteSpace: 'normal' }}>{dm.title}</span>} 
                description={
                  <div style={{ marginTop: 8 }}>
                    <Paragraph ellipsis={{ rows: 2 }} type="secondary">{dm.content}</Paragraph>
                    {dm.valid_until && (
                      <div style={{ marginTop: 8, color: '#fa8c16', fontSize: 12 }}>
                        <ClockCircleOutlined style={{ marginRight: 4 }} />
                        期限至: {dayjs(dm.valid_until).format('YYYY/MM/DD')}
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      {dm.tags && dm.tags.map((tag: string) => <Tag color="blue" key={tag}>{tag}</Tag>)}
                    </div>
                  </div>
                } 
              />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default MemberDMList;
