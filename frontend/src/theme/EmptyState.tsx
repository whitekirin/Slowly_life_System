import React from 'react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  /** 下拉選單、Select 等小空間用：只留一行字 */
  compact?: boolean;
  action?: React.ReactNode;
}

// 極簡線性插圖：一個打開的收納盒，米白＋暖棕、低細節
const BoxIllustration: React.FC = () => (
  <svg width="96" height="72" viewBox="0 0 96 72" fill="none" aria-hidden="true">
    <ellipse cx="48" cy="64" rx="34" ry="4" fill="#E8DCCB" />
    <path d="M18 30 L48 40 L78 30 L78 56 L48 64 L18 56 Z" fill="#FBF6EE" stroke="#9C7E60" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M48 40 L48 64" stroke="#9C7E60" strokeWidth="1.5" />
    <path d="M18 30 L10 21 L40 12 L48 20" stroke="#9C7E60" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" fill="#F1E6D6" />
    <path d="M78 30 L86 21 L56 12 L48 20" stroke="#9C7E60" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" fill="#F1E6D6" />
    <path d="M63 7 q3 -4 6 0" stroke="#9C7E60" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const EmptyState: React.FC<EmptyStateProps> = ({
  title = '這裡目前還是空的',
  description = '有資料之後會整齊地出現在這裡。',
  compact = false,
  action,
}) => {
  if (compact) {
    return <div className="sl-empty sl-empty--compact">目前沒有資料</div>;
  }
  return (
    <div className="sl-empty">
      <BoxIllustration />
      <div className="sl-empty__title">{title}</div>
      <div className="sl-empty__desc">{description}</div>
      {action && <div className="sl-empty__action">{action}</div>}
    </div>
  );
};

export default EmptyState;
