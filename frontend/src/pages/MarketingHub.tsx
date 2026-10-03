import React, { useState } from 'react';
import { Card, Tabs, Table, Button, Space, Modal, Form, Input, Select, DatePicker, Checkbox, message, Tag, Statistic, Row, Col, List, Divider } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SendOutlined, BarChartOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import JoditEditor from 'jodit-react';
import { editorConfig } from '../utils/editorConfig';
import { useUser } from '../contexts/UserContext';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

import {
  getMessageTemplates, createMessageTemplate, updateMessageTemplate, deleteMessageTemplate,
  getTargetSegments, createTargetSegment, updateTargetSegment, deleteTargetSegment,
  getCampaigns, createCampaign, updateCampaignStatus, getCampaignStats,
  getAutomatedTriggers, createAutomatedTrigger, deleteAutomatedTrigger
} from '../api';

const { TabPane } = Tabs;
const { Option } = Select;

const MarketingHub: React.FC = () => {
  return (
    <Card title="行銷中心">
      <Tabs defaultActiveKey="campaigns">
        <TabPane tab="推播活動 (Campaigns)" key="campaigns">
          <CampaignsTab />
        </TabPane>
        <TabPane tab="訊息模板 (Templates)" key="templates">
          <TemplatesTab />
        </TabPane>
        <TabPane tab="目標受眾 (Segments)" key="segments">
          <SegmentsTab />
        </TabPane>
        <TabPane tab="自動化觸發 (Triggers)" key="triggers">
          <TriggersTab />
        </TabPane>
      </Tabs>
    </Card>
  );
};

// --- Campaigns Tab ---
const CampaignsTab: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_marketing');
  const canEdit = hasPermission('edit_marketing');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [contentHtml, setContentHtml] = useState('');
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const textareaRef = React.useRef<any>(null);

  const { data: campaigns, isLoading } = useQuery({ queryKey: ['campaigns'], queryFn: getCampaigns });
  const { data: segments } = useQuery({ queryKey: ['segments'], queryFn: getTargetSegments });
  const { data: templates } = useQuery({ queryKey: ['templates'], queryFn: getMessageTemplates });

  const createMutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: () => {
      message.success('活動建立成功');
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (err: any) => message.error(`建立失敗: ${err.response?.data?.detail || err.message}`)
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number, status: string }) => updateCampaignStatus(id, status),
    onSuccess: () => {
      message.success('狀態更新成功');
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    }
  });

  const loadStats = async (id: number) => {
    try {
      const data = await getCampaignStats(id);
      setStats(data);
      setIsStatsModalOpen(true);
    } catch (e: any) {
      message.error('讀取報表失敗');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '活動名稱', dataIndex: 'name', key: 'name' },
    { 
      title: '狀態', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => {
        const colors: any = { draft: 'default', scheduled: 'blue', processing: 'orange', completed: 'green', failed: 'red' };
        return <Tag color={colors[status]}>{status}</Tag>;
      }
    },
    { 
      title: '預定發送時間', 
      dataIndex: 'scheduled_at', 
      key: 'scheduled_at',
      render: (val: string) => val ? dayjs(val).format('YYYY-MM-DD HH:mm') : '立即發送'
    },
    { title: '發送通道', dataIndex: 'channels', key: 'channels', render: (val: string[]) => val.join(', ') },
    { title: '建立時間', dataIndex: 'created_at', key: 'created_at', render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          {canEdit && record.status === 'draft' && (
            <Button size="small" type="primary" onClick={() => updateStatusMutation.mutate({ id: record.id, status: 'scheduled' })}>發送/排程</Button>
          )}
          {record.status === 'completed' && (
            <Button size="small" icon={<BarChartOutlined />} onClick={() => loadStats(record.id)}>報表</Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>新增推播活動</Button>}
      </div>
      <Table columns={columns} dataSource={campaigns} rowKey="id" loading={isLoading} />

      <Modal title="新增推播活動" open={isModalOpen} onOk={() => form.submit()} onCancel={() => setIsModalOpen(false)} width={800}>
        <Form form={form} layout="vertical" onFinish={(values) => {
          if (!contentHtml || contentHtml === '<p><br></p>') {
            message.error('請輸入信件內容');
            return;
          }
          values.content_html = contentHtml;
          
          if (values.template_id) {
            const tpl = templates?.find((t: any) => t.id === values.template_id);
            if (tpl && !values.subject) {
               values.subject = tpl.subject;
            }
          }
          if (values.scheduled_at) {
            values.scheduled_at = values.scheduled_at.toISOString();
            values.status = 'scheduled';
          } else {
            values.status = 'scheduled'; // Send immediately
          }
          
          // Process attachments
          values.metadata_json = {
            discountCode: values.discount_code,
            actionUrl: values.action_url
          };
          delete values.template_id;
          delete values.discount_code;
          delete values.action_url;
          
          createMutation.mutate(values);
        }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="活動內部名稱" rules={[{ required: true }]}><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="segment_id" label="發送目標受眾">
                <Select placeholder="全體會員 (預設)" allowClear>
                  {segments?.map((s: any) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="channels" label="發送通道" rules={[{ required: true }]} initialValue={['in_app', 'email']}>
            <Checkbox.Group options={[{ label: '站內信 (In-App)', value: 'in_app' }, { label: '電子郵件 (Email)', value: 'email' }]} />
          </Form.Item>
          <Form.Item name="scheduled_at" label="預約發送時間 (留空為立即發送)">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="template_id" label="快速套用模板 (選填)">
            <Select placeholder="選擇模板自動帶入主旨與內容" allowClear onChange={(val) => {
               const tpl = templates?.find((t: any) => t.id === val);
               if (tpl) {
                 form.setFieldsValue({ subject: tpl.subject });
                 setContentHtml(tpl.content_html);
               }
            }}>
              {templates?.map((t: any) => <Option key={t.id} value={t.id}>{t.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="subject" label="信件/訊息主旨" rules={[{ required: true }]}><Input /></Form.Item>
          
          <Form.Item label="內容 (Rich Text)" required>
             <JoditEditor
               value={contentHtml}
               config={editorConfig}
               onBlur={newContent => setContentHtml(newContent)} // preferred to use only this option to update the content for performance reasons
               onChange={newContent => {}}
             />
          </Form.Item>
          
          <Divider><PaperClipOutlined /> 附加功能與連結</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="discount_code" label="專屬優惠碼 (選填)" help="若填寫，信件底部會自動產生優惠碼卡片">
                <Input placeholder="例如：SUMMER2025" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="action_url" label="活動連結 (Action URL - 選填)" help="信件底部會自動產生導購按鈕">
                <Input placeholder="https://..." />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

        <Modal title="活動成效報表" open={isStatsModalOpen} footer={null} onCancel={() => setIsStatsModalOpen(false)} width={800}>
        {stats && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={6}><Card><Statistic title="總發送目標數" value={stats.total_targets} /></Card></Col>
              <Col span={6}><Card><Statistic title="實際成功送出" value={stats.sent_count} valueStyle={{ color: '#4F6B58' }} /></Card></Col>
              <Col span={6}><Card><Statistic title="信件開啟數" value={stats.open_count} /></Card></Col>
              <Col span={6}><Card><Statistic title="信件點擊數" value={stats.click_count} /></Card></Col>
            </Row>
            
            <Row gutter={16} style={{ marginTop: 24 }}>
              <Col span={12}>
                <Card title="發送成功率" size="small">
                  <div style={{ height: 250 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie 
                          data={[
                            { name: '成功送出', value: stats.sent_count }, 
                            { name: '失敗或無效目標', value: stats.total_targets - stats.sent_count }
                          ]} 
                          cx="50%" cy="50%" innerRadius={60} outerRadius={80} fill="#8B6545" paddingAngle={5} dataKey="value"
                        >
                          <Cell key="cell-0" fill="#4F6B58" />
                          <Cell key="cell-1" fill="#B25B4C" />
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </Col>
              <Col span={12}>
                <Card title="開啟與互動" size="small">
                  <div style={{ height: 250 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: '成功送出', value: stats.sent_count },
                        { name: '開啟信件', value: stats.open_count },
                        { name: '點擊連結', value: stats.click_count },
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill="#8B6545" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </Col>
            </Row>
          </div>
        )}
      </Modal>
    </div>
  );
};

// --- Templates Tab ---
const TemplatesTab: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_marketing');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [contentHtml, setContentHtml] = useState('');
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const textareaRef = React.useRef<any>(null);

  const { data: templates, isLoading } = useQuery({ queryKey: ['templates'], queryFn: getMessageTemplates });

  const createMutation = useMutation({
    mutationFn: createMessageTemplate,
    onSuccess: () => {
      message.success('模板建立成功');
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
  });

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '模板名稱', dataIndex: 'name', key: 'name' },
    { title: '主旨', dataIndex: 'subject', key: 'subject' },
    { title: '建立時間', dataIndex: 'created_at', key: 'created_at', render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm') },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>新增模板</Button>}
      </div>
      <Table columns={columns} dataSource={templates} rowKey="id" loading={isLoading} />

      <Modal title="新增模板" open={isModalOpen} onOk={() => form.submit()} onCancel={() => setIsModalOpen(false)} width={800}>
        <Form form={form} layout="vertical" onFinish={(values) => {
          if (!contentHtml) {
             message.error("請輸入模板內容");
             return;
          }
          values.content_html = contentHtml;
          createMutation.mutate(values);
        }}>
          <Form.Item name="name" label="模板名稱" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="subject" label="信件/訊息主旨" rules={[{ required: true }]}><Input /></Form.Item>
          
          <Form.Item label="內容 (Rich Text)" required>
             <JoditEditor
               value={contentHtml}
               config={editorConfig}
               onBlur={newContent => setContentHtml(newContent)}
               onChange={newContent => {}}
             />
          </Form.Item>

          <Form.Item name="description" label="備註"><Input.TextArea /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

// --- Segments Tab ---
const SegmentsTab: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_marketing');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: segments, isLoading } = useQuery({ queryKey: ['segments'], queryFn: getTargetSegments });

  const createMutation = useMutation({
    mutationFn: createTargetSegment,
    onSuccess: () => {
      message.success('受眾建立成功');
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['segments'] });
    }
  });

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '受眾名稱', dataIndex: 'name', key: 'name' },
    { 
      title: '篩選條件', 
      dataIndex: 'filter_rules', 
      key: 'filter_rules',
      render: (rules: any) => (
        <Space direction="vertical">
          {rules?.level && <Tag>等級: {rules.level}</Tag>}
          {rules?.min_points !== undefined && <Tag>點數大於: {rules.min_points}</Tag>}
        </Space>
      )
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>新增受眾</Button>}
      </div>
      <Table columns={columns} dataSource={segments} rowKey="id" loading={isLoading} />

      <Modal title="新增目標受眾" open={isModalOpen} onOk={() => form.submit()} onCancel={() => setIsModalOpen(false)}>
        <Form form={form} layout="vertical" onFinish={(values) => {
           const payload = {
             name: values.name,
             description: values.description,
             filter_rules: {
               level: values.level,
               min_points: values.min_points
             }
           };
           createMutation.mutate(payload);
        }}>
          <Form.Item name="name" label="受眾名稱" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="level" label="限定等級"><Select allowClear><Option value="Bronze">Bronze</Option><Option value="Silver">Silver</Option><Option value="Gold">Gold</Option></Select></Form.Item>
          <Form.Item name="min_points" label="最少點數要求"><Input type="number" /></Form.Item>
          <Form.Item name="description" label="備註"><Input.TextArea /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

// --- Triggers Tab ---
const TriggersTab: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_marketing');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: triggers, isLoading } = useQuery({ queryKey: ['triggers'], queryFn: getAutomatedTriggers });
  const { data: templates } = useQuery({ queryKey: ['templates'], queryFn: getMessageTemplates });

  const createMutation = useMutation({
    mutationFn: createAutomatedTrigger,
    onSuccess: () => {
      message.success('觸發器建立成功');
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['triggers'] });
    }
  });

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '名稱', dataIndex: 'name', key: 'name' },
    { title: '觸發事件', dataIndex: 'event_type', key: 'event_type' },
    { title: '狀態', dataIndex: 'is_active', key: 'is_active', render: (val: boolean) => <Tag color={val ? 'green' : 'red'}>{val ? '啟用' : '停用'}</Tag> },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>新增自動化觸發</Button>}
      </div>
      <Table columns={columns} dataSource={triggers} rowKey="id" loading={isLoading} />

      <Modal title="新增自動化觸發" open={isModalOpen} onOk={() => form.submit()} onCancel={() => setIsModalOpen(false)}>
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item name="name" label="觸發器名稱" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="event_type" label="觸發事件" rules={[{ required: true }]}>
            <Select>
              <Option value="birthday">生日當天</Option>
              <Option value="register">註冊滿一週</Option>
            </Select>
          </Form.Item>
          <Form.Item name="template_id" label="發送模板" rules={[{ required: true }]}>
            <Select>
              {templates?.map((t: any) => <Option key={t.id} value={t.id}>{t.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="is_active" valuePropName="checked" initialValue={true}>
             <Checkbox>立即啟用</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default MarketingHub;
