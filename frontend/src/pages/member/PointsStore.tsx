import React, { useState } from 'react';
import { Typography, Row, Col, Card, Button, Modal, Spin, message, Empty, Divider, Table, Tabs } from 'antd';
import { GiftOutlined, StarFilled, InfoCircleOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPointsEvents, exchangePoints, getPointsHistory } from '../../memberApi';
import { useMember } from '../../contexts/MemberContext';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

const PointsStore: React.FC = () => {
  const { member, refetchMember } = useMember();
  const queryClient = useQueryClient();
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);

  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ['points_events'],
    queryFn: getPointsEvents,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['points_history'],
    queryFn: getPointsHistory,
  });

  const exchangeMutation = useMutation({
    mutationFn: exchangePoints,
    onSuccess: (data) => {
      message.success(`兌換成功！折扣碼已寄送至您的電子信箱與會員收件匣。`);
      setIsModalVisible(false);
      refetchMember();
      queryClient.invalidateQueries({ queryKey: ['points_history'] });
    },
    onError: (err: any) => {
      message.error(err.response?.data?.detail || '兌換失敗，請確認點數餘額');
      setIsModalVisible(false);
    }
  });

  const handleExchangeClick = (event: any) => {
    if (member!.points < event.required_points) {
      message.warning('您的紅利點數不足以兌換此獎項');
      return;
    }
    setSelectedEvent(event);
    setIsModalVisible(true);
  };

  const confirmExchange = () => {
    if (selectedEvent) {
      exchangeMutation.mutate(selectedEvent.id);
    }
  };

  const StoreContent = () => {
    if (eventsLoading) return <Spin style={{ display: 'block', margin: '50px auto' }} />;
    if (!events || !Array.isArray(events) || events.length === 0) return <Empty description="目前無兌換活動" />;

    return (
      <Row gutter={[16, 16]}>
        {events.map((event: any) => (
          <Col xs={24} sm={12} md={8} key={event.id}>
            <Card 
              hoverable 
              style={{ height: '100%', display: 'flex', flexDirection: 'column', border: '1px solid #e8e8e8' }}
              bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <GiftOutlined style={{ fontSize: 48, color: '#531dab' }} />
              </div>
              <Title level={4} style={{ textAlign: 'center', margin: '0 0 8px 0' }}>{event.title}</Title>
              <Paragraph type="secondary" style={{ textAlign: 'center', flex: 1 }}>
                {event.description || '無詳細說明'}
              </Paragraph>
              <div style={{ background: '#f9f0ff', padding: '12px', borderRadius: 8, marginBottom: 16 }}>
                <Text strong style={{ color: '#531dab', display: 'block', textAlign: 'center', fontSize: 18 }}>
                  <StarFilled style={{ marginRight: 8, color: '#faad14' }} />
                  {event.required_points} 點
                </Text>
              </div>
              <Button 
                type="primary" 
                block 
                size="large"
                onClick={() => handleExchangeClick(event)}
                disabled={member!.points < event.required_points}
              >
                立即兌換 (Exchange)
              </Button>
            </Card>
          </Col>
        ))}
      </Row>
    );
  };

  const HistoryContent = () => {
    if (historyLoading) return <Spin style={{ display: 'block', margin: '50px auto' }} />;
    
    const columns = [
      { title: '活動名稱', dataIndex: 'event_title', key: 'event_title' },
      { title: '消耗點數', dataIndex: 'points_used', key: 'points_used', render: (val: number) => <Text type="danger">-{val}</Text> },
      { title: '兌換時間', dataIndex: 'created_at', key: 'created_at', render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm') },
      { title: '有效期限', dataIndex: 'valid_until', key: 'valid_until', render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm') },
    ];

    return <Table dataSource={Array.isArray(history) ? history : []} columns={columns} rowKey="id" pagination={{ pageSize: 10 }} />;
  };

  return (
    <div>
      <Card style={{ background: 'linear-gradient(135deg, #531dab 0%, #9254de 100%)', color: 'white', marginBottom: 24, borderRadius: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={3} style={{ color: 'white', margin: 0 }}>紅利商店 (Points Store)</Title>
            <Text style={{ color: 'rgba(255,255,255,0.8)' }}>兌換專屬折扣碼，購物更划算！</Text>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16 }}>目前可用點數</Text>
            <div style={{ fontSize: 36, fontWeight: 'bold', color: '#ffd666', textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
              {member?.points || 0} pts
            </div>
          </div>
        </div>
      </Card>

      <Tabs 
        items={[
          { key: 'store', label: '點數兌換 (Exchange)', children: <StoreContent /> },
          { key: 'history', label: '兌換紀錄 (History)', children: <HistoryContent /> },
        ]} 
      />

      <Modal
        title="確認兌換"
        open={isModalVisible}
        onOk={confirmExchange}
        onCancel={() => setIsModalVisible(false)}
        confirmLoading={exchangeMutation.isPending}
        okText="確定兌換"
        cancelText="取消"
      >
        {selectedEvent && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <InfoCircleOutlined style={{ fontSize: 48, color: '#faad14', marginBottom: 16 }} />
            <Title level={4}>您確定要兌換「{selectedEvent.title}」嗎？</Title>
            <Paragraph>
              此操作將扣除您的 <Text strong type="danger">{selectedEvent.required_points} 點</Text> 紅利點數。<br/>
              兌換成功後，折扣碼將立即顯示並寄送至您的註冊信箱。
            </Paragraph>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PointsStore;
