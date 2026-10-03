import React, { useState } from 'react';
import { Table, Card, Input, DatePicker, Button, Tag, Space, Typography, Row, Col } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getSystemLogs, exportSystemLogs } from '../api';
import { SearchOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import ExpandableDetailCard from '../components/ExpandableDetailCard';
import { isLiffMode } from '../liffSession';

const { RangePicker } = DatePicker;
const { Title } = Typography;

const SystemLogs: React.FC = () => {
  // 從 LINE 開啟時隱藏跟 LINE 專用功能衝突、或在 LINE 內建瀏覽器用不了的功能（匯入／匯出等）
  const fromLine = isLiffMode();
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [keyword, setKeyword] = useState<string>('');
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['systemLogs', page, limit, keyword, dateRange],
        queryFn: () => getSystemLogs({
            page,
            limit,
            keyword: keyword || undefined,
            start_date: dateRange?.[0]?.toISOString(),
            end_date: dateRange?.[1]?.toISOString()
        }),
        placeholderData: (previousData) => previousData,
    });

    // Helper for export
    const handleExport = async () => {
        try {
            const blob = await exportSystemLogs({
                keyword: keyword || undefined,
                start_date: dateRange?.[0]?.toISOString(),
                end_date: dateRange?.[1]?.toISOString()
            });
            const url = window.URL.createObjectURL(new Blob([blob]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `system_logs_${dayjs().format('YYYYMMDDHHmmss')}.csv`);
            document.body.appendChild(link);
            link.click();
            link.parentNode?.removeChild(link);
        } catch (error) {
            console.error('Export failed:', error);
        }
    };

    // Prepare chart data (from current page data)
    const actionStats = data?.items?.reduce((acc: any, curr: any) => {
        const key = curr.action_label || curr.action;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    
    const actionChartData = Object.keys(actionStats || {}).map(key => ({
        name: key,
        count: actionStats[key]
    }));

    const statusStats = data?.items?.reduce((acc: any, curr: any) => {
        const key = curr.status_label || curr.status;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const statusChartData = Object.keys(statusStats || {}).map(key => ({
        name: key,
        value: statusStats[key]
    }));

    const COLORS = ['#8B6545', '#4F6B58', '#B07F45', '#8E8171', '#B25B4C'];

    const columns = [
        {
            title: '編號',
            dataIndex: 'id',
            key: 'id',
            width: 80,
        },
        {
            title: '時間',
            dataIndex: 'timestamp',
            key: 'timestamp',
            width: 180,
            render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
        },
        {
            title: '操作人',
            dataIndex: 'operator',
            key: 'operator',
            width: 160,
        },
        {
            title: '動作',
            dataIndex: 'action_label',
            key: 'action',
            width: 100,
            render: (text: string) => <Tag color="blue">{text}</Tag>,
        },
        {
            title: '功能',
            dataIndex: 'resource_label',
            key: 'resource',
            width: 120,
        },
        {
            title: '結果',
            dataIndex: 'status_label',
            key: 'status',
            width: 90,
            render: (text: string, record: any) => (
                <Tag color={record.status === 'success' ? 'green' : 'red'}>{text}</Tag>
            ),
        },
        {
            title: '詳情',
            dataIndex: 'details',
            key: 'details',
            width: 480,
            render: (_details: string, record: any) => <ExpandableDetailCard record={record} />,
        },
    ];

    return (
        <div style={{ padding: 24 }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Title level={2}>系統日誌</Title>
                {!fromLine && (
                    <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
                        匯出 CSV
                    </Button>
                )}
            </div>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} md={12}>
                    <Card title="動作分佈（本頁）">
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={actionChartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <RechartsTooltip />
                                <Legend />
                                <Bar dataKey="count" name="筆數" fill="#8B6545" />
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>
                </Col>
                <Col xs={24} md={12}>
                    <Card title="結果分佈（本頁）">
                         <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                                <Pie
                                    data={statusChartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={40}
                                    outerRadius={80}
                                    fill="#8B6545"
                                    paddingAngle={5}
                                    dataKey="value"
                                    label
                                >
                                    {statusChartData.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <RechartsTooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </Card>
                </Col>
            </Row>

            <Card style={{ marginBottom: 24 }}>
                <Space wrap>
                    <RangePicker 
                        showTime 
                        onChange={(dates) => setDateRange(dates as any)} 
                    />
                    <Input 
                        placeholder="搜尋操作人、動作、功能或詳情內容" 
                        prefix={<SearchOutlined />} 
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        style={{ width: 300, maxWidth: '100%' }}
                        allowClear
                    />
                    <Button icon={<ReloadOutlined />} onClick={() => refetch()}>重新整理</Button>
                </Space>
            </Card>

            <Table
                columns={columns}
                dataSource={data?.items || []}
                loading={isLoading}
                rowKey="id"
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: data?.total || 0,
                    onChange: (p, l) => {
                        setPage(p);
                        setLimit(l);
                    },
                    showSizeChanger: true,
                    showTotal: (total) => `共 ${total} 筆記錄`,
                }}
                scroll={{ x: 1280 }}
            />
        </div>
    );
};

export default SystemLogs;
