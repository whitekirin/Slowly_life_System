import React, { useState } from 'react';
import { 
  Table, Button, Card, Modal, Form, Input, InputNumber, 
  Select, DatePicker, Row, Col, Typography, Tag, message, Statistic, Space, Popconfirm 
} from 'antd';
import { 
  PlusOutlined, EditOutlined, DeleteOutlined, DownloadOutlined,
  ArrowUpOutlined, ArrowDownOutlined, DollarOutlined 
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { getTransactions, getMonthlyTransactionSummary, createTransaction, updateTransaction, deleteTransaction } from '../api';
import { useUser } from '../contexts/UserContext';
import {
  CATEGORY_LABELS, PAYMENT_METHOD_LABELS, translateDescription, emptySummary, exportMonthlyReport,
  cumulativeNetAt, totalOf,
  type MonthlySummary, type Transaction,
} from '../utils/accountingExport';

const { Title } = Typography;
const { Option } = Select;

const money = (value: number) => `$${Math.round(value).toLocaleString()}`;

const Accounting: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_finance');
  const canEdit = hasPermission('edit_finance');
  const [form] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  // 記帳一律按月看：選一個月份，卡片、明細、匯出都針對這個月
  const [selectedMonth, setSelectedMonth] = useState<Dayjs>(() => dayjs().startOf('month'));
  const month = selectedMonth.format('YYYY-MM');
  const queryClient = useQueryClient();

  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions', 'list', month],
    queryFn: () => getTransactions({ month }),
  });

  const { data: monthlySummaries = [], isLoading: isMonthlyLoading } = useQuery<MonthlySummary[]>({
    queryKey: ['transactions', 'monthly'],
    queryFn: getMonthlyTransactionSummary,
  });

  const summary = monthlySummaries.find((m) => m.month === month) ?? emptySummary(month);
  // 目前總損益 = 所有月份的收入 − 支出（出貨收入 − 進貨成本 − 退款 − 包材等其他支出 + 其他收入）
  const overall = totalOf(monthlySummaries);
  const cumulativeAtMonth = cumulativeNetAt(monthlySummaries, month);
  const profitColor = (value: number) => (value >= 0 ? '#4F6B58' : '#B25B4C');

  // Mutations
  const createMutation = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      message.success('新增成功');
      setIsModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateTransaction,
    onSuccess: () => {
      message.success('更新成功');
      setIsModalOpen(false);
      setEditingId(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      message.success('刪除成功');
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const handleEdit = (record: any) => {
    setEditingId(record.id);
    form.setFieldsValue({
      ...record,
      category: record.category ? [record.category] : [],
      date: dayjs(record.date),
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id);
  };

  const handleOk = () => {
    form.validateFields().then((values) => {
      // Handle category array from mode="tags" - take the last selected tag
      let categoryStr = values.category;
      if (Array.isArray(values.category)) {
          categoryStr = values.category.length > 0 ? values.category[values.category.length - 1] : '';
      }

      const data = {
        ...values,
        category: categoryStr,
        date: values.date.toISOString(),
      };
      if (editingId) {
        updateMutation.mutate({ id: editingId, data });
      } else {
        createMutation.mutate(data);
      }
    });
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    form.resetFields();
  };

  const handleExport = () => {
    if (transactions.length === 0) {
      message.warning(`${month} 沒有任何記帳紀錄可匯出`);
      return;
    }
    exportMonthlyReport(month, summary, transactions, cumulativeAtMonth);
  };

  const monthlyColumns = [
    {
      title: '月份',
      dataIndex: 'month',
      key: 'month',
      render: (value: string) => <strong>{value}</strong>,
    },
    { title: '出貨收入', dataIndex: 'sales', key: 'sales', align: 'right' as const, render: money },
    { title: '進貨成本', dataIndex: 'purchase', key: 'purchase', align: 'right' as const, render: money },
    { title: '退款', dataIndex: 'refund', key: 'refund', align: 'right' as const, render: money },
    { title: '其他收入', dataIndex: 'other_income', key: 'other_income', align: 'right' as const, render: money },
    { title: '其他支出', dataIndex: 'other_expense', key: 'other_expense', align: 'right' as const, render: money },
    {
      title: '總收入',
      dataIndex: 'income',
      key: 'income',
      align: 'right' as const,
      render: (value: number) => <span style={{ color: '#4F6B58' }}>{money(value)}</span>,
    },
    {
      title: '總支出',
      dataIndex: 'expense',
      key: 'expense',
      align: 'right' as const,
      render: (value: number) => <span style={{ color: '#B25B4C' }}>{money(value)}</span>,
    },
    {
      title: '當月損益',
      dataIndex: 'net',
      key: 'net',
      align: 'right' as const,
      render: (value: number) => <strong style={{ color: profitColor(value) }}>{money(value)}</strong>,
    },
    {
      title: '累計損益',
      dataIndex: 'cumulative_net',
      key: 'cumulative_net',
      align: 'right' as const,
      render: (value: number) => <strong style={{ color: profitColor(value) }}>{money(value)}</strong>,
    },
    { title: '筆數', dataIndex: 'count', key: 'count', align: 'right' as const },
  ];

  const columns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      render: (text: string) => dayjs(text).format('YYYY-MM-DD'),
      sorter: (a: any, b: any) => dayjs(a.date).unix() - dayjs(b.date).unix(),
    },
    {
      title: '類型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <Tag color={type === 'income' ? 'green' : 'red'}>
          {type === 'income' ? '收入' : '支出'}
        </Tag>
      ),
    },
    {
      title: '類別',
      dataIndex: 'category',
      key: 'category',
      render: (category: string) => CATEGORY_LABELS[category] ?? category,
    },
    {
      title: '金額',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number, record: any) => (
        <span style={{ color: record.type === 'income' ? 'green' : 'red', fontWeight: 'bold' }}>
          {record.type === 'income' ? '+' : '-'}${amount.toLocaleString()}
        </span>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (description: string) => translateDescription(description),
    },
    {
      title: '支付方式',
      dataIndex: 'payment_method',
      key: 'payment_method',
      render: (method: string) => PAYMENT_METHOD_LABELS[method] ?? method,
    },
    {
      title: '建立者',
      dataIndex: 'created_by',
      key: 'created_by',
      render: (name?: string) => name || '-',
    },
    {
      title: '經手者',
      dataIndex: 'handled_by',
      key: 'handled_by',
      render: (name?: string) => name || '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => canEdit && (
        <Space size="middle">
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm title="確定要刪除嗎？" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div className="sl-page-head" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>記帳管理</Title>
        <Space wrap>
            <DatePicker
                picker="month"
                value={selectedMonth}
                allowClear={false}
                format="YYYY 年 MM 月"
                onChange={(value) => value && setSelectedMonth(value.startOf('month'))}
                style={{ width: 160 }}
            />
            <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={isLoading}>
            匯出本月報表
            </Button>
            {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setIsModalOpen(true); form.setFieldValue('date', dayjs()); }}>
            記一筆
            </Button>
            )}
        </Space>
      </div>

      <Card title="目前總損益（全部月份累計）" style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={6}>
            <Statistic
              title={overall.net >= 0 ? '目前獲利' : '目前虧損'}
              value={overall.net}
              precision={0}
              loading={isMonthlyLoading}
              valueStyle={{ color: profitColor(overall.net), fontSize: 32 }}
              prefix={<DollarOutlined />}
              suffix="$"
            />
          </Col>
          <Col xs={12} md={4}><Statistic title="累計出貨收入" value={overall.sales} precision={0} suffix="$" /></Col>
          <Col xs={12} md={4}><Statistic title="累計進貨成本" value={overall.purchase} precision={0} suffix="$" /></Col>
          <Col xs={12} md={3}><Statistic title="累計退款" value={overall.refund} precision={0} suffix="$" /></Col>
          <Col xs={12} md={4}><Statistic title="累計其他支出" value={overall.other_expense} precision={0} suffix="$" /></Col>
          <Col xs={12} md={3}><Statistic title="累計其他收入" value={overall.other_income} precision={0} suffix="$" /></Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title={`${month} 總收入`}
              value={summary.income}
              precision={0}
              valueStyle={{ color: '#4F6B58' }}
              prefix={<ArrowUpOutlined />}
              suffix="$"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title={`${month} 總支出`}
              value={summary.expense}
              precision={0}
              valueStyle={{ color: '#B25B4C' }}
              prefix={<ArrowDownOutlined />}
              suffix="$"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title={`${month} 當月損益`}
              value={summary.net}
              precision={0}
              valueStyle={{ color: profitColor(summary.net) }}
              prefix={<DollarOutlined />}
              suffix="$"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title={`累計損益（截至 ${month}）`}
              value={cumulativeAtMonth}
              precision={0}
              valueStyle={{ color: profitColor(cumulativeAtMonth) }}
              prefix={<DollarOutlined />}
              suffix="$"
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={4}><Statistic title="出貨收入" value={summary.sales} precision={0} suffix="$" /></Col>
          <Col xs={12} md={5}><Statistic title="其他收入" value={summary.other_income} precision={0} suffix="$" /></Col>
          <Col xs={12} md={5}><Statistic title="進貨成本" value={summary.purchase} precision={0} suffix="$" /></Col>
          <Col xs={12} md={5}><Statistic title="退款" value={summary.refund} precision={0} suffix="$" /></Col>
          <Col xs={12} md={5}><Statistic title="其他支出" value={summary.other_expense} precision={0} suffix="$" /></Col>
        </Row>
      </Card>

      <Card title={`${month} 收支明細`} style={{ marginBottom: 24 }}>
        <Table
          columns={columns}
          dataSource={transactions}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 5, showSizeChanger: false, showTotal: (total) => `共 ${total} 筆` }}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Card title="每月帳簿" extra={<span style={{ color: '#888' }}>點選月份可切換上方的明細</span>}>
        <Table
          columns={monthlyColumns}
          dataSource={monthlySummaries}
          rowKey="month"
          loading={isMonthlyLoading}
          pagination={{ pageSize: 12 }}
          scroll={{ x: 'max-content' }}
          onRow={(record) => ({
            onClick: () => setSelectedMonth(dayjs(`${record.month}-01`)),
            style: {
              cursor: 'pointer',
              background: record.month === month ? '#e6f4ff' : undefined,
            },
          })}
        />
      </Card>

      <Modal
        title={editingId ? "編輯紀錄" : "新增紀錄"}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={handleCloseModal}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'expense', payment_method: 'Cash' }}>
          <Form.Item name="date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="type" label="類型" rules={[{ required: true }]}>
                <Select>
                  <Option value="income">收入 (Income)</Option>
                  <Option value="expense">支出 (Expense)</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="類別" rules={[{ required: true }]}>
                 <Select mode="tags" placeholder="選擇或輸入新類別">
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <Option key={value} value={value}>{label}</Option>
                    ))}
                 </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="amount" label="金額" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} prefix="$" />
          </Form.Item>

          <Form.Item name="payment_method" label="支付方式">
            <Select>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <Option key={value} value={value}>{label}</Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="description" label="描述/備註">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Accounting;
