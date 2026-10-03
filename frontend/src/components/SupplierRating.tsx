import React from 'react';
import { Alert, Modal, Rate, Space, Tag, Typography } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import dayjs from 'dayjs';

// 等級門檻與扣分規則在 backend/supplier_rating.py，這裡只負責顯示
export type SupplierGrade = 'A' | 'B' | 'C' | 'D';

export const GRADE_META: Record<SupplierGrade, { label: string; color: string; hint: string }> = {
  A: { label: 'A 優良', color: 'green', hint: '4.5 星以上' },
  B: { label: 'B 普通', color: 'blue', hint: '3.5～4 星' },
  C: { label: 'C 注意', color: 'orange', hint: '2.5～3 星' },
  D: { label: 'D 高風險', color: 'red', hint: '2 星以下' },
};

export interface SupplierRatingInfo {
  name: string;
  rating?: number;
  grade?: SupplierGrade;
  shortage_count?: number;
  last_shortage_at?: string | null;
  last_shortage_note?: string | null;
}

const gradeOf = (s: SupplierRatingInfo): SupplierGrade => s.grade ?? 'A';

// 有短收紀錄或等級不是 A，建立採購單時就要提醒
export const isFlaggedSupplier = (s?: SupplierRatingInfo | null) =>
  !!s && ((s.shortage_count ?? 0) > 0 || gradeOf(s) !== 'A');

export const SupplierGradeTag: React.FC<{ grade?: SupplierGrade }> = ({ grade = 'A' }) => (
  <Tag color={GRADE_META[grade].color} style={{ marginInlineEnd: 0 }}>{GRADE_META[grade].label}</Tag>
);

export const SupplierStars: React.FC<{ rating?: number; size?: number }> = ({ rating = 5, size = 14 }) => (
  <Rate disabled allowHalf value={rating} style={{ fontSize: size }} />
);

// 供應商下拉選單的選項：名稱 + 等級 + 短收警示
export const SupplierOptionLabel: React.FC<{ supplier: SupplierRatingInfo }> = ({ supplier }) => (
  <Space size={6}>
    {(supplier.shortage_count ?? 0) > 0 && <WarningFilled style={{ color: GRADE_META[gradeOf(supplier)].color === 'green' ? '#B98035' : '#B25B4C' }} />}
    <span>{supplier.name}</span>
    <SupplierGradeTag grade={gradeOf(supplier)} />
    <span style={{ color: '#8c8c8c', fontSize: 12 }}>{(supplier.rating ?? 5).toFixed(1)}★</span>
    {(supplier.shortage_count ?? 0) > 0 && <span style={{ color: '#B25B4C', fontSize: 12 }}>短收 {supplier.shortage_count} 次</span>}
  </Space>
);

const RiskDetail: React.FC<{ supplier: SupplierRatingInfo }> = ({ supplier }) => (
  <div>
    <Space size={8} wrap>
      <SupplierGradeTag grade={gradeOf(supplier)} />
      <SupplierStars rating={supplier.rating} />
      <span>{(supplier.rating ?? 5).toFixed(1)} / 5</span>
    </Space>
    <div style={{ marginTop: 8 }}>
      累計短收 <b>{supplier.shortage_count ?? 0}</b> 次
      {supplier.last_shortage_at && <>，最近一次：{dayjs(supplier.last_shortage_at).format('YYYY-MM-DD HH:mm')}</>}
    </div>
    {supplier.last_shortage_note && (
      <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
        {supplier.last_shortage_note}
      </Typography.Paragraph>
    )}
    {gradeOf(supplier) === 'D' && (
      <div style={{ marginTop: 8, color: '#B25B4C', fontWeight: 600 }}>高風險供應商，建議改選其他供應商；若仍要下單，請於驗收時特別清點數量。</div>
    )}
  </div>
);

// 選好供應商後常駐在欄位下方的標註
export const SupplierRiskAlert: React.FC<{ supplier?: SupplierRatingInfo | null }> = ({ supplier }) => {
  if (!supplier || !isFlaggedSupplier(supplier)) return null;
  const grade = gradeOf(supplier);
  return (
    <Alert
      showIcon
      type={grade === 'D' ? 'error' : 'warning'}
      style={{ marginTop: -8, marginBottom: 16 }}
      message={`${supplier.name}：${GRADE_META[grade].label}，此供應商有短收紀錄`}
      description={<RiskDetail supplier={supplier} />}
    />
  );
};

// 選取供應商當下跳出的提醒視窗
export const showSupplierRiskModal = (supplier?: SupplierRatingInfo | null) => {
  if (!supplier || !isFlaggedSupplier(supplier)) return;
  const grade = gradeOf(supplier);
  (grade === 'D' ? Modal.error : Modal.warning)({
    title: `注意：${supplier.name}（${GRADE_META[grade].label}）`,
    content: <RiskDetail supplier={supplier} />,
    okText: '我知道了',
    width: 520,
  });
};

// 對 D 級供應商送出新採購單前再確認一次；回傳 false 代表使用者取消
export const confirmHighRiskSupplier = (supplier?: SupplierRatingInfo | null): Promise<boolean> => {
  if (!supplier || gradeOf(supplier) !== 'D') return Promise.resolve(true);
  return new Promise((resolve) => {
    Modal.confirm({
      title: `確定要向高風險供應商「${supplier.name}」下單嗎？`,
      content: <RiskDetail supplier={supplier} />,
      okText: '仍要建立',
      okButtonProps: { danger: true },
      cancelText: '返回修改',
      width: 520,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
};
