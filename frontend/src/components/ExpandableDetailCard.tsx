import React, { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, Descriptions, Image, Modal, Tag, Typography } from 'antd';
import dayjs from 'dayjs';

const { Paragraph, Text } = Typography;

interface SystemLogItem {
  id: number;
  timestamp: string;
  username: string;
  operator?: string;
  action: string;
  action_label?: string;
  resource: string;
  resource_label?: string;
  status: string;
  status_label?: string;
  details?: string;
}

interface ExpandableDetailCardProps {
  record: SystemLogItem;
}

const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url);
const isVideoUrl = (url: string) => /\.(mp4|webm|ogg|mov)$/i.test(url);

const extractMediaUrls = (details?: string) => {
  if (!details) return [];
  const matches = details.match(/https?:\/\/[^\s"'<>]+/g) || [];
  return Array.from(new Set(matches));
};

const parseDetailsObject = (details?: string): Record<string, unknown> | null => {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
};

const ExpandableDetailCard: React.FC<ExpandableDetailCardProps> = ({ record }) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const detailsObject = useMemo(() => parseDetailsObject(record.details), [record.details]);
  const mediaUrls = useMemo(() => extractMediaUrls(record.details), [record.details]);

  const actionText = record.action_label || record.action;
  const resourceText = record.resource_label || record.resource;
  // 摘要只顯示第一行之後的異動內容（第一行是操作名稱，已經在「動作」「功能」欄看得到）
  const detailLines = (record.details || '').split('\n').filter(Boolean);
  const summaryText = (detailLines.length > 1 ? detailLines.slice(1).join(' ') : detailLines[0]) || `${actionText}${resourceText}`;

  const openModal = () => setOpen(true);
  const closeModal = () => setOpen(false);
  const onSummaryKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openModal();
    }
  };

  return (
    <div className="expandable-detail-card">
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="查看更多詳細資訊"
        onClick={openModal}
        onKeyDown={onSummaryKeyDown}
        className="expandable-detail-summary"
      >
        <Paragraph className="expandable-detail-summary-text">
          {summaryText}
        </Paragraph>
        <Button type="link" className="expandable-detail-toggle-btn">
          查看更多
        </Button>
      </div>

      <Modal
        open={open}
        onCancel={closeModal}
        title="詳細資訊"
        width={900}
        centered
        footer={[
          <Button key="close" onClick={closeModal}>
            收起
          </Button>
        ]}
      >
      <div id={panelId} className="expandable-detail-modal-content" aria-hidden={!open}>
        <div className="expandable-detail-content-inner">
          <Descriptions
            column={{ xs: 1, sm: 1, md: 2 }}
            size="small"
            bordered
            items={[
              { key: 'user', label: '操作人', children: record.operator || record.username },
              { key: 'time', label: '時間', children: dayjs(record.timestamp).format('YYYY-MM-DD HH:mm:ss') },
              { key: 'action', label: '動作', children: <Tag color="blue">{actionText}</Tag> },
              { key: 'resource', label: '功能', children: resourceText },
              {
                key: 'status',
                label: '結果',
                children: <Tag color={record.status === 'success' ? 'green' : 'red'}>{record.status_label || record.status}</Tag>
              }
            ]}
          />

          {detailsObject && (
            <Descriptions
              style={{ marginTop: 12 }}
              column={{ xs: 1, sm: 1, md: 2 }}
              size="small"
              bordered
              title="詳細欄位"
              items={Object.entries(detailsObject).map(([key, value]) => ({
                key,
                label: key,
                children: typeof value === 'string' ? value : JSON.stringify(value)
              }))}
            />
          )}

          {record.details && (
            <div style={{ marginTop: 12 }}>
              <Text strong>操作內容</Text>
              <Paragraph style={{ marginTop: 8, marginBottom: 0, whiteSpace: 'pre-wrap' }}>{record.details}</Paragraph>
            </div>
          )}

          {mediaUrls.length > 0 && (
            <div className="expandable-detail-media-wrap">
              {mediaUrls.map((url) => {
                if (isImageUrl(url)) {
                  return <Image key={url} src={url} alt="日誌附件" className="expandable-detail-image" />;
                }
                if (isVideoUrl(url)) {
                  return (
                    <video key={url} controls className="expandable-detail-video">
                      <source src={url} />
                    </video>
                  );
                }
                return (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </Modal>
    </div>
  );
};

export default ExpandableDetailCard;
