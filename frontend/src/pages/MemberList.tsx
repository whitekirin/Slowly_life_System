import React, { useState } from 'react';
import { Table, Button, Input, Select, Tag, Space, Card, Row, Col, DatePicker, Breadcrumb, message, Modal, Form, InputNumber, Descriptions, Checkbox } from 'antd';
import { SearchOutlined, DownloadOutlined, ReloadOutlined, ExclamationCircleOutlined, EyeOutlined, EditOutlined, SendOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getMembers, sendDirectMessage, getMessageTemplates } from '../api';
import * as XLSX from 'xlsx';
import JoditEditor from 'jodit-react';
import { editorConfig } from '../utils/editorConfig';

import dayjs from 'dayjs';
import { Link } from 'react-router-dom';

import { useUser } from '../contexts/UserContext';
import { isLiffMode } from '../liffSession';
const { Option } = Select;
const { confirm } = Modal;

const MemberList: React.FC = () => {
  // 從 LINE 開啟時隱藏跟 LINE 專用功能衝突、或在 LINE 內建瀏覽器用不了的功能（匯入／匯出等）
  const fromLine = isLiffMode();
  const { hasPermission } = useUser();
  const canEdit = hasPermission('edit_members');
  const canSendMessage = hasPermission('create_marketing');
  const [params, setParams] = useState<any>({
    skip: 0,
    limit: 100,
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [viewingMember, setViewingMember] = useState<any>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [contentHtml, setContentHtml] = useState('');
  const [form] = Form.useForm();
  const [msgForm] = Form.useForm();
  const queryClient = useQueryClient();
  const textareaRef = React.useRef<any>(null);

  const { data: members, isLoading, refetch } = useQuery({
    queryKey: ['members', params],
    queryFn: () => getMembers(params),
  });

  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: getMessageTemplates
  });

  const handleSearch = (value: string) => {
    setParams({ ...params, search: value });
  };

  const handleFilterChange = (key: string, value: any) => {
    const newParams = { ...params, [key]: value };
    if (!value) delete newParams[key];
    setParams(newParams);
  };

  const exportToExcel = () => {
    if (!members || members.length === 0) {
      message.warning('沒有資料可匯出 (No data to export)');
      return;
    }
    const dataToExport = members.filter((m: any) => selectedRowKeys.length === 0 || selectedRowKeys.includes(m.id));
    const ws = XLSX.utils.json_to_sheet(dataToExport.map((m: any) => ({
      ID: m.id,
      姓名: m.name,
      手機: m.phone,
      Email: m.email,
      性別: m.gender,
      等級: m.level,
      點數: m.points,
      消費總額: m.total_spent,
      加入日期: dayjs(m.created_at).format('YYYY-MM-DD'),
      狀態: m.is_active ? 'Active' : 'Inactive'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Members");
    XLSX.writeFile(wb, `members_${dayjs().format('YYYYMMDD')}.xlsx`);
    message.success('匯出成功 (Export successful)');
  };

  const handleBulkStatusChange = async (isActive: boolean) => {
    if (selectedRowKeys.length === 0) {
      message.warning('請先選擇會員 (Please select members first)');
      return;
    }
    
    confirm({
      title: '確認批次變更狀態?',
      icon: <ExclamationCircleOutlined />,
      content: `即將變更 ${selectedRowKeys.length} 位會員狀態。`,
      onOk: async () => {
        try {
          // Simple loop for MVP. In prod, create a bulk API endpoint
          for (const id of selectedRowKeys) {
            await api.patch(`/members/${id}`, { is_active: isActive });
          }
          message.success('批次更新成功 (Bulk update successful)');
          setSelectedRowKeys([]);
          refetch();
        } catch (error: any) {
          message.error('批次更新失敗: ' + (error.response?.data?.detail || error.message));
        }
      },
    });
  };

  const openDetailModal = (record: any) => {
    setViewingMember(record);
    setIsEditMode(false);
    form.setFieldsValue({
      level: record.level || 'Bronze',
      points: record.points || 0,
    });
    setIsDetailModalOpen(true);
  };

  const handleAdjustSubmit = async () => {
    try {
      const values = await form.validateFields();
      await api.patch(`/members/${viewingMember.id}`, values);
      message.success('會員資料調整成功 (Member adjusted successfully)');
      setIsDetailModalOpen(false);
      setIsEditMode(false);
      refetch();
    } catch (error: any) {
       message.error('更新失敗: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleSendMessageSubmit = async () => {
    try {
      const values = await msgForm.validateFields();
      if (!contentHtml) {
         message.error('請輸入訊息內容');
         return;
      }
      const payload = {
        member_ids: selectedRowKeys,
        subject: values.subject,
        content_html: contentHtml,
        channels: values.channels,
        metadata_json: {
           discountCode: values.discount_code,
           actionUrl: values.action_url
        }
      };
      await sendDirectMessage(payload);
      message.success(`成功排程發送訊息給 ${selectedRowKeys.length} 位會員`);
      setIsMessageModalOpen(false);
      setSelectedRowKeys([]);
      msgForm.resetFields();
      setContentHtml('');
    } catch (error: any) {
      message.error('發送失敗: ' + (error.response?.data?.detail || error.message));
    }
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '姓名 (Name)', dataIndex: 'name', key: 'name' },
    { title: '手機 (Phone)', dataIndex: 'phone', key: 'phone' },
    { 
      title: '等級 (Level)', 
      dataIndex: 'level', 
      key: 'level',
      render: (level: string) => {
        let color = 'geekblue';
        if (level === 'Gold') color = 'gold';
        if (level === 'Silver') color = 'silver';
        if (level === 'Platinum') color = 'purple';
        return <Tag color={color}>{level || 'Bronze'}</Tag>;
      }
    },
    { title: '點數 (Points)', dataIndex: 'points', key: 'points' },
    { 
      title: '消費總額 (Total Spent)', 
      dataIndex: 'total_spent', 
      key: 'total_spent',
      render: (val: number) => `$${val?.toLocaleString() || 0}`
    },
    { 
      title: '加入日期 (Joined)', 
      dataIndex: 'created_at', 
      key: 'created_at',
      render: (val: string) => dayjs(val).format('YYYY-MM-DD')
    },
    {
      title: '狀態 (Status)',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'red'}>{active ? 'Active' : 'Inactive'}</Tag>
      )
    },
    {
      title: '操作 (Action)',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" type="primary" icon={<EyeOutlined />} onClick={() => openDetailModal(record)}>詳情 (Details)</Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Breadcrumb style={{ margin: '0 0 16px 0' }}>
        <Breadcrumb.Item><Link to="/">首頁</Link></Breadcrumb.Item>
        <Breadcrumb.Item>會員管理 (Members)</Breadcrumb.Item>
        <Breadcrumb.Item>會員列表 (Member List)</Breadcrumb.Item>
      </Breadcrumb>
      <Card title="會員管理" extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>重新整理</Button>
          {!fromLine && <Button type="primary" icon={<DownloadOutlined />} onClick={exportToExcel}>匯出 Excel</Button>}
        </Space>
      }>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <Input.Search placeholder="搜尋姓名/手機/Email" onSearch={handleSearch} allowClear />
          </Col>
          <Col xs={12} sm={6} md={4}>
            <Select 
              placeholder="會員等級" 
              style={{ width: '100%' }} 
              allowClear
              onChange={(val) => handleFilterChange('level', val)}
            >
              <Option value="Bronze">Bronze</Option>
              <Option value="Silver">Silver</Option>
              <Option value="Gold">Gold</Option>
              <Option value="Platinum">Platinum</Option>
            </Select>
          </Col>
          <Col xs={12} sm={6} md={4}>
            <Select 
              placeholder="狀態" 
              style={{ width: '100%' }} 
              allowClear
              onChange={(val) => handleFilterChange('active', val)}
            >
              <Option value={true}>Active</Option>
              <Option value={false}>Inactive</Option>
            </Select>
          </Col>
          <Col xs={24} sm={12} md={10} style={{ textAlign: 'right' }}>
            {selectedRowKeys.length > 0 && (
              <Space>
                <span style={{ marginLeft: 8 }}>已選擇 {selectedRowKeys.length} 項</span>
                {canSendMessage && <Button type="primary" icon={<SendOutlined />} onClick={() => setIsMessageModalOpen(true)}>發送訊息</Button>}
                {canEdit && <Button onClick={() => handleBulkStatusChange(true)}>批次啟用</Button>}
                {canEdit && <Button danger onClick={() => handleBulkStatusChange(false)}>批次停用</Button>}
              </Space>
            )}
          </Col>
        </Row>

        <Table 
          rowSelection={canEdit || canSendMessage ? rowSelection : undefined}
          columns={columns} 
          dataSource={members} 
          rowKey="id" 
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1000 }} // Responsive scrolling
        />
      </Card>

      <Modal
        title={`會員詳情: ${viewingMember?.name || ''}`}
        open={isDetailModalOpen}
        onCancel={() => {
          setIsDetailModalOpen(false);
          setIsEditMode(false);
        }}
        footer={isEditMode ? [
          <Button key="cancel" onClick={() => setIsEditMode(false)}>取消</Button>,
          <Button key="submit" type="primary" onClick={handleAdjustSubmit}>儲存變更</Button>,
        ] : [
          canEdit && <Button key="edit" type="primary" icon={<EditOutlined />} onClick={() => setIsEditMode(true)}>手動調整等級/點數</Button>,
          <Button key="close" onClick={() => setIsDetailModalOpen(false)}>關閉</Button>,
        ]}
        width={700}
        destroyOnClose
      >
        {viewingMember && !isEditMode && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="會員 ID">{viewingMember.id}</Descriptions.Item>
            <Descriptions.Item label="姓名">{viewingMember.name}</Descriptions.Item>
            <Descriptions.Item label="手機">{viewingMember.phone}</Descriptions.Item>
            <Descriptions.Item label="Email">{viewingMember.email || '未提供'}</Descriptions.Item>
            <Descriptions.Item label="等級">
              <Tag color="blue">{viewingMember.level || 'Bronze'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="紅利點數">{viewingMember.points} 點</Descriptions.Item>
            <Descriptions.Item label="消費總額">${viewingMember.total_spent?.toLocaleString() || 0}</Descriptions.Item>
            <Descriptions.Item label="狀態">
              <Tag color={viewingMember.is_active ? 'green' : 'red'}>{viewingMember.is_active ? '啟用中' : '已停用'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="生日">{viewingMember.birthday ? dayjs(viewingMember.birthday).format('YYYY-MM-DD') : '未提供'}</Descriptions.Item>
            <Descriptions.Item label="性別">{viewingMember.gender || '未提供'}</Descriptions.Item>
            <Descriptions.Item label="加入時間" span={2}>{dayjs(viewingMember.created_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
            <Descriptions.Item label="備註" span={2}>{viewingMember.note || '無'}</Descriptions.Item>
          </Descriptions>
        )}

        {viewingMember && isEditMode && (
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Card type="inner" title="手動調整" size="small" style={{ borderColor: '#B98035' }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="level" label="會員等級 (Level)" rules={[{ required: true }]}>
                    <Select>
                      <Option value="Bronze">Bronze</Option>
                      <Option value="Silver">Silver</Option>
                      <Option value="Gold">Gold</Option>
                      <Option value="Platinum">Platinum</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="points" label="紅利點數 (Points)" rules={[{ required: true }]} help="修改點數將會自動寫入系統稽核日誌。">
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Form>
        )}
      </Modal>

      <Modal
        title={`發送訊息給 ${selectedRowKeys.length} 位會員`}
        open={isMessageModalOpen}
        onOk={handleSendMessageSubmit}
        onCancel={() => setIsMessageModalOpen(false)}
        width={700}
        destroyOnClose
      >
        <Form form={msgForm} layout="vertical" onValuesChange={(changed) => {
          if (changed.template_id && templates) {
             const tpl = templates.find((t: any) => t.id === changed.template_id);
             if (tpl) {
                msgForm.setFieldsValue({ subject: tpl.subject });
                setContentHtml(tpl.content_html);
             }
          }
        }}>
          <Form.Item name="channels" label="發送通道" rules={[{ required: true }]} initialValue={['in_app', 'email']}>
            <Checkbox.Group options={[{ label: '站內信 (In-App)', value: 'in_app' }, { label: '電子郵件 (Email)', value: 'email' }]} />
          </Form.Item>
          <Form.Item name="template_id" label="快速套用模板 (選填)">
            <Select placeholder="選擇模板自動帶入主旨與內容" allowClear>
              {templates?.map((t: any) => <Option key={t.id} value={t.id}>{t.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="subject" label="主旨" rules={[{ required: true }]}><Input /></Form.Item>
          
          <Form.Item label="內容 (Rich Text)" required>
             <JoditEditor
               value={contentHtml}
               config={editorConfig}
               onBlur={newContent => setContentHtml(newContent)}
               onChange={newContent => {}}
             />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default MemberList;
