import React, { useState } from 'react';
import { Table, Button, Modal, Form, Input, message, Popconfirm, Typography, Space, Row, Col, Select, Tag, Tooltip, Rate, Timeline, Divider, Empty } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, getSupplierRatingLogs } from '../api';
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, FormOutlined, WarningFilled, StarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { GRADE_META, SupplierGradeTag, isFlaggedSupplier, type SupplierGrade } from '../components/SupplierRating';

import { useUser } from '../contexts/UserContext';
const { Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const RATING_EVENT_LABELS: Record<string, string> = {
  receiving_shortage: '驗收短收',
  supplementary_shortage: '補驗收仍短收',
  manual_adjust: '手動調整',
};

const SupplierList: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_suppliers');
  const canEdit = hasPermission('edit_suppliers');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  // Search & Filter State
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [gradeFilter, setGradeFilter] = useState<SupplierGrade | undefined>(undefined);

  // Rating Modal State
  const [ratingSupplier, setRatingSupplier] = useState<any>(null);
  const [ratingForm] = Form.useForm();

  // Note Modal State
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [noteSupplier, setNoteSupplier] = useState<any>(null);

  const [form] = Form.useForm();
  const [noteForm] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: suppliers, isLoading } = useQuery({ 
      queryKey: ['suppliers', searchText, categoryFilter, gradeFilter], 
      queryFn: () => getSuppliers({ name: searchText, category: categoryFilter, grade: gradeFilter }),
      placeholderData: (previousData) => previousData ?? []
  });

  const { data: ratingLogs, isLoading: isRatingLogsLoading } = useQuery({
      queryKey: ['supplier-rating-logs', ratingSupplier?.id],
      queryFn: () => getSupplierRatingLogs(ratingSupplier.id),
      enabled: !!ratingSupplier,
  });

  const ratingMutation = useMutation({
    mutationFn: updateSupplier,
    onSuccess: (updated: any) => {
        message.success('評分已更新');
        setRatingSupplier(updated);
        ratingForm.setFieldsValue({ rating: updated.rating, rating_reason: undefined });
        queryClient.invalidateQueries({ queryKey: ['suppliers'] });
        queryClient.invalidateQueries({ queryKey: ['supplier-rating-logs', updated.id] });
    },
    onError: (error: any) => {
        message.error(error.response?.data?.detail || '評分更新失敗');
    }
  });

  const handleOpenRatingModal = (record: any) => {
      setRatingSupplier(record);
  };

  const handleSaveRating = async () => {
      const values = await ratingForm.validateFields();
      if (values.rating === ratingSupplier.rating) {
          message.info('評分沒有變動');
          return;
      }
      ratingMutation.mutate({ id: ratingSupplier.id, data: values });
  };

  const createMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: () => {
      message.success('供應商建立成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error: any) => {
        const msg = error.response?.data?.detail || '建立失敗';
        message.error(msg);
    }
  });

  const updateMutation = useMutation({
    mutationFn: updateSupplier,
    onSuccess: () => {
        message.success('供應商更新成功');
        handleCloseModal();
        setIsNoteModalOpen(false);
        queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error: any) => {
        const msg = error.response?.data?.detail || '更新失敗';
        message.error(msg);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSupplier,
    onSuccess: () => {
      message.success('供應商刪除成功');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error: any) => {
        const msg = error.response?.data?.detail || '刪除失敗';
        message.error(msg);
    }
  });

  const handleOpenModal = (record?: any) => {
    if (record) {
        setEditingId(record.id);
        form.setFieldsValue(record);
    } else {
        setEditingId(null);
        form.resetFields();
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    form.resetFields();
  };

  const handleOk = async () => {
    try {
        const values = await form.validateFields();
        if (editingId) {
            updateMutation.mutate({ id: editingId, data: values });
        } else {
            createMutation.mutate(values);
        }
    } catch (error) {
        console.error("Validation Failed:", error);
    }
  };

  // Note Handlers
  const handleOpenNoteModal = (record: any) => {
      setNoteSupplier(record);
      noteForm.setFieldsValue({ note: record.note });
      setIsNoteModalOpen(true);
  };

  const handleSaveNote = async () => {
      try {
          const values = await noteForm.validateFields();
          if (noteSupplier) {
              updateMutation.mutate({ id: noteSupplier.id, data: { note: values.note } });
          }
      } catch (error) {
          console.error("Validation Failed:", error);
      }
  };

  const columns = [
    {
        title: '供應商名稱',
        dataIndex: 'name',
        key: 'name',
        render: (text: string, record: any) => isFlaggedSupplier(record) ? (
            <Space size={6}>
                <WarningFilled style={{ color: record.grade === 'A' || record.grade === 'B' ? '#B98035' : '#B25B4C' }} />
                <b>{text}</b>
            </Space>
        ) : text
    },
    {
        title: '評分 / 等級',
        key: 'rating',
        sorter: (a: any, b: any) => (a.rating ?? 5) - (b.rating ?? 5),
        render: (_: unknown, record: any) => (
            <Space size={6} style={{ cursor: 'pointer' }} onClick={() => handleOpenRatingModal(record)}>
                <Rate disabled allowHalf value={record.rating ?? 5} style={{ fontSize: 13 }} />
                <SupplierGradeTag grade={record.grade} />
            </Space>
        )
    },
    {
        title: '短收標註',
        key: 'shortage',
        sorter: (a: any, b: any) => (a.shortage_count ?? 0) - (b.shortage_count ?? 0),
        render: (_: unknown, record: any) => record.shortage_count > 0 ? (
            <Tooltip title={
                <div style={{ whiteSpace: 'pre-wrap' }}>
                    最近一次：{dayjs(record.last_shortage_at).format('YYYY-MM-DD HH:mm')}{'\n'}{record.last_shortage_note}
                </div>
            }>
                <Tag color="red" icon={<WarningFilled />} style={{ cursor: 'pointer' }} onClick={() => handleOpenRatingModal(record)}>
                    短收 {record.shortage_count} 次
                </Tag>
            </Tooltip>
        ) : <span style={{ color: '#bfbfbf' }}>-</span>
    },
    { 
        title: '類別', 
        dataIndex: 'category', 
        key: 'category',
        render: (text: string) => text ? <Tag color={text === '1688賣家' ? 'orange' : 'blue'}>{text}</Tag> : '-'
    },
    { title: '聯絡人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '電話', dataIndex: 'phone', key: 'phone' },
    { title: '網址', dataIndex: 'website', key: 'website', render: (text: string) => text ? <a href={text} target="_blank" rel="noopener noreferrer">連結</a> : '-' },
    {
        title: '備註',
        key: 'note',
        render: (_: unknown, record: any) => (
            (record.note || canEdit) ? (
            <Button 
                type={record.note ? "primary" : "default"} 
                ghost={!!record.note}
                size="small" 
                icon={<FormOutlined />} 
                onClick={() => handleOpenNoteModal(record)}
            >
                {record.note ? (canEdit ? '查看/編輯' : '查看') : '新增備註'}
            </Button>
            ) : null
        )
    },
    {
        title: '操作',
        key: 'action',
        render: (_: unknown, record: any) => (
            <Space>
                <Tooltip title="評分紀錄 / 調整評分">
                    <Button type="text" icon={<StarOutlined />} onClick={() => handleOpenRatingModal(record)} />
                </Tooltip>
                {canEdit && <Button type="text" icon={<EditOutlined />} onClick={() => handleOpenModal(record)} />}
                {canEdit && (
                <Popconfirm title="確定要刪除嗎？" onConfirm={() => deleteMutation.mutate(record.id)}>
                    <Button type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
                )}
            </Space>
        )
    }
  ];

  return (
    <div style={{ padding: '24px' }}>
      <style>{`
        .supplier-row-flagged > td { background: #fffbe6 !important; }
        .supplier-row-grade-C > td { background: #fff7e6 !important; }
        .supplier-row-grade-D > td { background: #fff1f0 !important; }
        .supplier-row-flagged > td:first-child { box-shadow: inset 3px 0 0 #B98035; }
        .supplier-row-grade-D > td:first-child { box-shadow: inset 3px 0 0 #B25B4C; }
      `}</style>
      <div className="sl-page-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, alignItems: 'center' }}>
        <Title level={2} style={{ margin: 0 }}>供應商管理</Title>
        <Space>
            <Select
                placeholder="篩選等級"
                style={{ width: 140 }}
                allowClear
                onChange={setGradeFilter}
                options={(Object.keys(GRADE_META) as SupplierGrade[]).map(g => ({ value: g, label: `${GRADE_META[g].label}（${GRADE_META[g].hint}）` }))}
                popupMatchSelectWidth={false}
            />
            <Select 
                placeholder="篩選類別" 
                style={{ width: 150 }} 
                allowClear 
                onChange={setCategoryFilter}
            >
                <Option value="1688賣家">1688賣家</Option>
                <Option value="淘寶賣家">淘寶賣家</Option>
            </Select>
            <Input 
                placeholder="搜尋供應商名稱..." 
                prefix={<SearchOutlined />} 
                onChange={e => setSearchText(e.target.value)} 
                style={{ width: 250 }}
                allowClear
            />
            {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>新增供應商</Button>}
        </Space>
      </div>
      
      <Table 
        dataSource={Array.isArray(suppliers) ? suppliers : []}
        columns={columns} 
        rowKey="id" 
        loading={isLoading} 
        pagination={{ pageSize: 10 }}
        rowClassName={(record: any) => isFlaggedSupplier(record) ? `supplier-row-flagged supplier-row-grade-${record.grade}` : ''}
        locale={{ emptyText: searchText ? '查無符合條件的供應商' : '暫無供應商資料' }}
      />

      {/* Create/Edit Modal */}
      <Modal 
        title={editingId ? "編輯供應商" : "新增供應商"} 
        open={isModalOpen} 
        onOk={handleOk} 
        onCancel={handleCloseModal}
        okText={editingId ? "更新" : "建立"}
        cancelText="取消"
        width={700}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
            <Row gutter={16}>
                <Col span={12}>
                    <Form.Item name="name" label="供應商名稱" rules={[{ required: true, message: '請輸入供應商名稱' }]}>
                        <Input placeholder="例如: 1688店家 / 某某貿易公司" />
                    </Form.Item>
                </Col>
                <Col span={12}>
                    <Form.Item name="category" label="供應商類別">
                        <Select placeholder="請選擇類別">
                            <Option value="1688賣家">1688賣家</Option>
                            <Option value="淘寶賣家">淘寶賣家</Option>
                        </Select>
                    </Form.Item>
                </Col>
            </Row>
            <Row gutter={16}>
                <Col span={12}>
                    <Form.Item name="contact_person" label="聯絡人">
                        <Input placeholder="姓名" />
                    </Form.Item>
                </Col>
                <Col span={12}>
                    <Form.Item name="phone" label="電話">
                        <Input placeholder="09xx-xxx-xxx" />
                    </Form.Item>
                </Col>
            </Row>
            <Row gutter={16}>
                <Col span={12}>
                    <Form.Item name="email" label="Email">
                        <Input placeholder="example@company.com" />
                    </Form.Item>
                </Col>
                <Col span={12}>
                    <Form.Item name="website" label="網址/賣場連結">
                        <Input placeholder="https://..." />
                    </Form.Item>
                </Col>
            </Row>
            <Row gutter={16}>
                <Col span={12}>
                    <Form.Item name="bank_account" label="銀行帳號">
                        <Input placeholder="銀行代碼-帳號" />
                    </Form.Item>
                </Col>
                <Col span={12}>
                    <Form.Item name="address" label="地址">
                        <Input placeholder="公司地址" />
                    </Form.Item>
                </Col>
            </Row>
        </Form>
      </Modal>

      {/* Rating Modal */}
      <Modal
        title={`評分紀錄 - ${ratingSupplier?.name || ''}`}
        open={!!ratingSupplier}
        onOk={handleSaveRating}
        onCancel={() => setRatingSupplier(null)}
        okText="儲存評分"
        okButtonProps={{ style: { display: canEdit ? undefined : 'none' } }}
        cancelText="關閉"
        confirmLoading={ratingMutation.isPending}
        width={640}
        destroyOnHidden
      >
          {ratingSupplier && (
              <>
                  <Space size={8} wrap style={{ marginBottom: 12 }}>
                      <SupplierGradeTag grade={ratingSupplier.grade} />
                      <span>目前 {Number(ratingSupplier.rating ?? 5).toFixed(1)} / 5 星</span>
                      <span style={{ color: '#8c8c8c' }}>累計短收 {ratingSupplier.shortage_count ?? 0} 次</span>
                  </Space>
                  <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 12 }}>
                      驗收短收時自動扣分：短收比例 &lt;10% 扣 0.5 星、10～30% 扣 1 星、≥30% 扣 1.5 星。
                      補驗收單：同一張採購單第 2 張起仍短收才扣分（依該補驗收單的待補數計算比例）。
                      等級：A ≥4.5、B ≥3.5、C ≥2.5、D &lt;2.5。
                  </div>
                  {canEdit && (
                  <Form form={ratingForm} layout="vertical" initialValues={{ rating: ratingSupplier.rating ?? 5 }}>
                      <Form.Item name="rating" label="手動調整評分（例如供應商改善後恢復評分）">
                          <Rate allowHalf allowClear={false} />
                      </Form.Item>
                      <Form.Item name="rating_reason" label="調整原因" rules={[{ required: true, message: '請填寫調整原因' }]}>
                          <Input placeholder="例如：已補寄短收商品、連續三批準時足量" maxLength={200} />
                      </Form.Item>
                  </Form>
                  )}
                  <Divider style={{ margin: '8px 0 16px' }}>評分異動紀錄</Divider>
                  {isRatingLogsLoading ? null : ratingLogs?.length ? (
                      <Timeline items={ratingLogs.map((log: any) => ({
                          color: log.rating_after < log.rating_before ? 'red' : 'green',
                          children: (
                              <div>
                                  <div>
                                      <b>{RATING_EVENT_LABELS[log.event_type] ?? log.event_type}</b>
                                      {' '}{Number(log.rating_before).toFixed(1)} → {Number(log.rating_after).toFixed(1)} 星
                                      <span style={{ color: '#8c8c8c', marginLeft: 8, fontSize: 12 }}>
                                          {dayjs(log.created_at).format('YYYY-MM-DD HH:mm')}{log.created_by_name ? ` · ${log.created_by_name}` : ''}
                                      </span>
                                  </div>
                                  {log.description && <div style={{ color: '#595959', whiteSpace: 'pre-wrap' }}>{log.description}</div>}
                              </div>
                          ),
                      }))} />
                  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚無評分異動" />}
              </>
          )}
      </Modal>

      {/* Note Modal */}
      <Modal
        title={`備註管理 - ${noteSupplier?.name || ''}`}
        open={isNoteModalOpen}
        onOk={handleSaveNote}
        onCancel={() => setIsNoteModalOpen(false)}
        okText="儲存備註"
        okButtonProps={{ style: { display: canEdit ? undefined : 'none' } }}
        cancelText="關閉"
        confirmLoading={updateMutation.isPending}
        destroyOnClose
      >
          <Form form={noteForm} layout="vertical">
              {noteSupplier?.note_updated_at && (
                  <div style={{ marginBottom: 16, color: '#999', fontSize: 12 }}>
                      最後更新時間: {dayjs(noteSupplier.note_updated_at).format('YYYY-MM-DD HH:mm:ss')}
                  </div>
              )}
              <Form.Item 
                name="note" 
                label="備註內容" 
                help="需包含：商品品質問題描述、合作意願評估、具體改進建議"
                rules={[
                    { min: 10, message: '備註內容最少需 10 個字' },
                    { max: 500, message: '備註內容最多 500 個字' }
                ]}
              >
                  <TextArea readOnly={!canEdit}
                    rows={6} 
                    placeholder="請輸入備註內容..." 
                    showCount 
                    maxLength={500} 
                  />
              </Form.Item>
          </Form>
      </Modal>
    </div>
  );
};

export default SupplierList;
