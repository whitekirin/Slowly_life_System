import React, { useState, useEffect } from 'react';
import { List, Typography, Spin, Tag, Space, Button, Badge, Empty, Pagination, Avatar, Modal, message } from 'antd';
import { MailOutlined, CheckCircleOutlined, InfoCircleOutlined, TagOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMailSymbols, markMailSymbolRead } from '../../memberApi';
import { useMember } from '../../contexts/MemberContext';
import dayjs from 'dayjs';
import DOMPurify from 'dompurify';

// Defense in depth: the backend already sanitizes mail-symbol content with a
// tag/attribute whitelist (bleach) before it's stored, but this content is
// rendered via dangerouslySetInnerHTML, so it's sanitized again here in case
// that ever regresses or a raw value slips through another path.
const sanitizeHtml = (html: string) => DOMPurify.sanitize(html);

const { Title, Text, Paragraph } = Typography;

const MailSymbols: React.FC = () => {
  const { member } = useMember();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  
  const [selectedMail, setSelectedMail] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: mailSymbols, isLoading } = useQuery({
    queryKey: ['mail_symbols', member?.id, currentPage],
    queryFn: () => getMailSymbols(member!.id, { page: currentPage, size: pageSize }),
    enabled: !!member?.id,
  });

  // WebSocket for Real-time Push
  useEffect(() => {
    if (!member?.id) return;

    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    
    const connectWS = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = import.meta.env.VITE_API_URL ? new URL(import.meta.env.VITE_API_URL).host : 'localhost:8000';
      const wsUrl = `${protocol}//${host}/api/v1/ws/mail-symbols/${member.id}`;
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('MailSymbols WS connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'NEW_MAIL' || data.type === 'MAIL_READ') {
            // Invalidate query to trigger refetch via React Query
            queryClient.invalidateQueries({ queryKey: ['mail_symbols', member.id] });
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onclose = () => {
        // Reconnect after 3 seconds on unexpected close
        retryTimer = setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    return () => {
      clearTimeout(retryTimer);
      if (ws) {
        ws.onclose = null; // Prevent reconnect on intentional unmount
        ws.close();
      }
    };
  }, [member?.id, queryClient]);

  const markReadMutation = useMutation({
    mutationFn: markMailSymbolRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail_symbols', member?.id] });
    },
  });

  const handleMarkRead = (id: string) => {
    markReadMutation.mutate(id);
  };

  const handleOpenMail = (item: any) => {
    setSelectedMail(item);
    setIsModalOpen(true);
    
    // Only mark as read if it is currently unread
    if (!item.isRead) {
      // Optimistically update the UI to avoid blocking
      queryClient.setQueryData(['mail_symbols', member?.id, currentPage], (oldData: any) => {
        if (!oldData) return oldData;
        return oldData.map((mail: any) => 
          mail.id === item.id ? { ...mail, isRead: true } : mail
        );
      });
      
      // Call API in the background with retry logic built into React Query (or we handle it manually)
      markReadMutation.mutate(item.id, {
        onError: () => {
          // Revert optimistic update on error
          queryClient.invalidateQueries({ queryKey: ['mail_symbols', member?.id] });
          message.error('無法標示為已讀，請稍後再試。');
        }
      });
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    // Add a slight delay before clearing selected mail to allow modal closing animation to finish smoothly
    setTimeout(() => setSelectedMail(null), 300);
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px 0' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>載入信件中...</div>
      </div>
    );
  }

  if (!mailSymbols || mailSymbols.length === 0) {
    return <Empty description="目前沒有任何信件 (No Mail Symbols)" style={{ margin: '50px 0' }} />;
  }

  const getSymbolTag = (type: string) => {
    switch (type) {
      case 'promo': return <Tag color="magenta"><TagOutlined /> 優惠 (Promo)</Tag>;
      case 'system': return <Tag color="blue"><InfoCircleOutlined /> 系統 (System)</Tag>;
      default: return <Tag color="default">其他 (Other)</Tag>;
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>信件夾 (Mail Box)</Title>
      <List
        itemLayout="vertical"
        size="large"
        dataSource={mailSymbols}
        renderItem={(item: any) => (
          <List.Item
            key={item.id}
            onClick={() => handleOpenMail(item)}
            style={{ 
              background: item.isRead ? '#fafafa' : '#fff',
              borderLeft: item.isRead ? '4px solid transparent' : '4px solid #1890ff',
              padding: '16px 24px',
              marginBottom: 12,
              borderRadius: 8,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'}
            actions={[
              <span key="date" style={{ color: '#8c8c8c' }} onClick={(e) => e.stopPropagation()}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                {dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}
              </span>,
              !item.isRead ? (
                <Button 
                  type="link" 
                  size="small" 
                  onClick={(e) => { e.stopPropagation(); handleMarkRead(item.id); }}
                  loading={markReadMutation.isPending && markReadMutation.variables === item.id}
                >
                  標示為已讀 (Mark as Read)
                </Button>
              ) : (
                <span key="read" style={{ color: '#52c41a' }} onClick={(e) => e.stopPropagation()}>
                  <CheckCircleOutlined style={{ marginRight: 4 }} />已讀
                </span>
              )
            ]}
          >
            <List.Item.Meta
              avatar={<Badge dot={!item.isRead}><Avatar icon={<MailOutlined />} style={{ backgroundColor: item.isRead ? '#d9d9d9' : '#1890ff' }} /></Badge>}
              title={
                <Space>
                  <Text strong={!item.isRead} style={{ fontSize: 16 }}>{item.title}</Text>
                  {getSymbolTag(item.symbolType)}
                </Space>
              }
            />
            {/* Render HTML safely since content might contain rich text or tracking pixels */}
            <div 
              style={{ color: item.isRead ? '#8c8c8c' : '#595959', marginTop: 8, marginBottom: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }}
            />
          </List.Item>
        )}
      />
      <div style={{ textAlign: 'right', marginTop: 16 }}>
        <Pagination 
          current={currentPage} 
          onChange={(page) => setCurrentPage(page)} 
          total={mailSymbols.length === pageSize ? currentPage * pageSize + 1 : currentPage * pageSize} 
          showSizeChanger={false}
        />
      </div>

      <Modal
        open={isModalOpen}
        onCancel={handleCloseModal}
        footer={null}
        width={600}
        styles={{ body: { padding: '24px 0 0 0' } }}
      >
        {selectedMail && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16 }}>
              <Avatar icon={<MailOutlined />} style={{ backgroundColor: '#531dab', marginRight: 16 }} size={48} />
              <div style={{ flex: 1 }}>
                <Title level={4} style={{ margin: 0, color: '#262626' }}>{selectedMail.title}</Title>
                <Space style={{ marginTop: 8 }}>
                  {getSymbolTag(selectedMail.symbolType)}
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {dayjs(selectedMail.createdAt).format('YYYY年MM月DD日 HH:mm')}
                  </Text>
                </Space>
              </div>
            </div>
            
            {selectedMail.symbolType === 'promo' && selectedMail.metadata?.discountCode && (
              <div style={{ padding: 16, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, textAlign: 'center', marginBottom: 16 }}>
                <Text>專屬折扣碼</Text>
                <Title level={3} style={{ margin: '8px 0', color: '#52c41a' }}>{selectedMail.metadata.discountCode}</Title>
              </div>
            )}
            <div 
              style={{ background: '#f9f9f9', padding: '20px', borderRadius: 8, fontSize: 15, lineHeight: 1.8, color: '#333', whiteSpace: 'pre-wrap' }}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedMail.content) }}
            />

            {selectedMail.metadata && Object.keys(selectedMail.metadata).length > 0 && (
              <div style={{ marginTop: 20, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                <Title level={5} style={{ fontSize: 14, color: '#8c8c8c' }}><InfoCircleOutlined /> 附件與額外資訊 (Attachments & Info)</Title>
                <div style={{ background: '#fafafa', padding: 12, borderRadius: 4, border: '1px dashed #d9d9d9' }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word', color: '#595959', fontSize: 13, fontFamily: 'monospace' }}>
                    {JSON.stringify(selectedMail.metadata, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default MailSymbols;
