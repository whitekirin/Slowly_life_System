import React, { useEffect, useState } from 'react';
import { Tabs, Form, Input, Button, Card, Table, message, Modal, Space, Tag, Popconfirm, Checkbox, Select, Typography } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSystemSettings, updateSystemSetting, getUsers, createUser, updateUserById, deleteUser, getDepartments, createDepartment, updateDepartment, deleteDepartment, startLineBind, getLineBindStatus, unbindLine, syncLineRichMenus } from '../api';
import { useNavigate } from 'react-router-dom';
import { PlusOutlined, UserOutlined, EditOutlined, DeleteOutlined, SearchOutlined, AppstoreOutlined } from '@ant-design/icons';
import PermissionMatrix from '../components/PermissionMatrix';
import { permissionLabel } from '../permissions';
import { isLiffMode } from '../liffSession';

const { TabPane } = Tabs;

interface SettingItem {
  key: string;
  value: string;
  description?: string;
}

const GeneralSettings: React.FC = () => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: getSystemSettings,
  });

  const updateMutation = useMutation({
    mutationFn: updateSystemSetting,
    onSuccess: () => {
      message.success('設定已更新');
      queryClient.invalidateQueries({ queryKey: ['systemSettings'] });
    },
    onError: () => {
      message.error('更新失敗');
    },
  });

  useEffect(() => {
    if (settings) {
      const initialValues: Record<string, string> = {};
      settings.forEach((s: SettingItem) => {
        initialValues[s.key] = s.value;
      });
      form.setFieldsValue(initialValues);
    }
  }, [settings, form]);

  const handleFinish = async (values: any) => {
    // Save each field individually
    const promises = Object.keys(values).map((key) => {
      return updateMutation.mutateAsync({
        key,
        value: values[key],
        description: getFieldDescription(key),
      });
    });

    await Promise.all(promises);
    message.success('所有設定已儲存');
  };

  const getFieldDescription = (key: string) => {
    switch (key) {
      case 'company_name': return '公司名稱';
      case 'company_address': return '公司地址';
      case 'tax_rate': return '稅率 (%)';
      default: return '';
    }
  };

  if (isLoading) return <Card loading />;

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} style={{ maxWidth: 600 }}>
      <Form.Item label="公司名稱 (Company Name)" name="company_name">
        <Input placeholder="輸入公司名稱" />
      </Form.Item>
      <Form.Item label="公司地址 (Address)" name="company_address">
        <Input placeholder="輸入公司地址" />
      </Form.Item>
      <Form.Item label="預設稅率 (Default Tax Rate %)" name="tax_rate">
        <Input placeholder="5" suffix="%" />
      </Form.Item>
      <Form.Item>
        <Button type="primary" htmlType="submit">
          儲存設定
        </Button>
      </Form.Item>
    </Form>
  );
};

const LineBindingSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const pollRef = React.useRef<number | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['lineBindStatus'],
    queryFn: getLineBindStatus,
  });

  const unbindMutation = useMutation({
    mutationFn: unbindLine,
    onSuccess: () => {
      message.success('已解除 LINE 綁定');
      queryClient.invalidateQueries({ queryKey: ['lineBindStatus'] });
    },
    onError: () => {
      message.error('解除綁定失敗');
    },
  });

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const handleBind = async () => {
    try {
      const { authorize_url } = await startLineBind();
      window.open(authorize_url, 'line-bind', 'width=480,height=720');

      stopPolling();
      const startedAt = Date.now();
      pollRef.current = window.setInterval(async () => {
        if (Date.now() - startedAt > 5 * 60 * 1000) {
          stopPolling();
          return;
        }
        const result = await getLineBindStatus();
        if (result.bound) {
          stopPolling();
          message.success('LINE 綁定成功');
          queryClient.invalidateQueries({ queryKey: ['lineBindStatus'] });
        }
      }, 2000);
    } catch {
      message.error('無法產生 LINE 綁定連結，請確認後端已設定 LINE Login 相關金鑰');
    }
  };

  if (isLoading) return <Card loading />;

  return (
    <Card style={{ maxWidth: 600 }}>
      {status?.bound ? (
        <Space direction="vertical" size="middle">
          <div>已綁定 LINE：{status.line_display_name || '(無顯示名稱)'}</div>
          <div>綁定時間：{status.line_bound_at}</div>
          <Popconfirm title="確定要解除 LINE 綁定嗎？解除後將不再收到系統推播通知。" onConfirm={() => unbindMutation.mutate()}>
            <Button danger>解除綁定</Button>
          </Popconfirm>
        </Space>
      ) : (
        <Space direction="vertical" size="middle">
          <div>尚未綁定 LINE。綁定後，系統事件（例如進貨完成、出貨完成）會主動推播通知到你的 LINE。</div>
          <Button type="primary" onClick={handleBind}>綁定 LINE</Button>
        </Space>
      )}
    </Card>
  );
};

// 綁定帳號的 LINE 圖文選單依權限自動切換（綁定、改帳號、改部門時）；這裡是手動全部重來一次，
// 用在第一次上線設定頻道預設選單，或改了撿貨部門等不會自動觸發的情況。
const LineRichMenuSync: React.FC = () => {
  const navigate = useNavigate();
  const syncMutation = useMutation({
    mutationFn: syncLineRichMenus,
    onSuccess: (data: { default_rich_menu_id: string | null; users: number }) => {
      message.success(`已同步 ${data.users} 個綁定帳號的 LINE 選單`);
      if (!data.default_rich_menu_id) message.warning('未綁定者的預設選單沒有設定成功（或目前關閉了 LINE 發送），詳見 line_delivery.log');
    },
    onError: (error: any) => message.error(error.response?.data?.detail || '同步失敗'),
  });

  return (
    <Card style={{ maxWidth: 600, marginTop: 16 }} title="LINE 圖文選單">
      <Space direction="vertical" size="middle">
        <div>每個綁定帳號在 LINE 看到的選單會依權限自動切換，未綁定的人看到「尚未綁定」選單。分組名稱、顏色與順序到「LINE 介面設定」調整。</div>
        <Space wrap>
          <Button type="primary" onClick={() => navigate('/line-menu-settings')}>前往 LINE 介面設定</Button>
          <Button loading={syncMutation.isPending} onClick={() => syncMutation.mutate()}>重新同步所有人的 LINE 選單</Button>
        </Space>
      </Space>
    </Card>
  );
};

const DepartmentManagement: React.FC = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingDept, setEditingDept] = useState<any>(null);
    const [form] = Form.useForm();
    const queryClient = useQueryClient();

    const { data: departments, isLoading } = useQuery({
        queryKey: ['departments'],
        queryFn: getDepartments,
    });

    const createMutation = useMutation({
        mutationFn: createDepartment,
        onSuccess: () => {
            message.success('部門建立成功');
            handleCloseModal();
            queryClient.invalidateQueries({ queryKey: ['departments'] });
        },
        onError: (error: any) => {
            message.error(error.response?.data?.detail || '建立失敗');
        }
    });

    const updateMutation = useMutation({
        mutationFn: updateDepartment,
        onSuccess: () => {
            message.success('部門更新成功');
            handleCloseModal();
            queryClient.invalidateQueries({ queryKey: ['departments'] });
        },
        onError: (error: any) => {
            message.error(error.response?.data?.detail || '更新失敗');
        }
    });

    const deleteMutation = useMutation({
        mutationFn: deleteDepartment,
        onSuccess: () => {
            message.success('部門刪除成功');
            queryClient.invalidateQueries({ queryKey: ['departments'] });
        },
        onError: (error: any) => {
            message.error(error.response?.data?.detail || '刪除失敗');
        }
    });

    const handleEdit = (record: any) => {
        setEditingDept(record);
        form.setFieldsValue(record);
        setIsModalOpen(true);
    };

    const handleDelete = (id: number) => {
        deleteMutation.mutate(id);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingDept(null);
        form.resetFields();
    };

    const onFinish = (values: any) => {
        if (editingDept) {
            updateMutation.mutate({ id: editingDept.id, data: values });
        } else {
            createMutation.mutate(values);
        }
    };

    const columns = [
        { title: '名稱 (Name)', dataIndex: 'name', key: 'name' },
        { title: '描述 (Description)', dataIndex: 'description', key: 'description' },
        { 
            title: '預設權限 (Permissions)', 
            dataIndex: 'default_permissions', 
            key: 'default_permissions',
            render: (perms: string[]) => (
                <div style={{ maxWidth: 300 }}>
                    {perms?.includes('all') ? <Tag color="red">全部權限</Tag> : 
                     perms?.map(p => <Tag key={p} style={{ marginBottom: 4 }}>{permissionLabel(p)}</Tag>)}
                </div>
            )
        },
        {
            title: '操作',
            key: 'action',
            render: (_: any, record: any) => (
                <Space>
                    <Button icon={<EditOutlined />} size="small" onClick={() => handleEdit(record)}>編輯</Button>
                    <Popconfirm title="確定要刪除此部門?" onConfirm={() => handleDelete(record.id)}>
                        <Button icon={<DeleteOutlined />} danger size="small">刪除</Button>
                    </Popconfirm>
                </Space>
            )
        }
    ];

    return (
        <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
                    新增部門
                </Button>
            </div>
            <Table columns={columns} dataSource={departments} rowKey="id" loading={isLoading} />
            <Modal
                title={editingDept ? "編輯部門" : "新增部門"}
                open={isModalOpen}
                onCancel={handleCloseModal}
                onOk={() => form.submit()}
                confirmLoading={createMutation.isPending || updateMutation.isPending}
                width={700}
            >
                <Form form={form} layout="vertical" onFinish={onFinish}>
                    <Form.Item name="name" label="部門名稱" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="description" label="描述">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="default_permissions" label="預設權限 (部門成員自動擁有，修改後立即套用到所有成員)">
                        <PermissionMatrix />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

const UserManagement: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', searchText],
    queryFn: () => getUsers(searchText),
  });
  
  const { data: departments } = useQuery({
      queryKey: ['departments'],
      queryFn: getDepartments
  });

  const selectedDepartment = Form.useWatch('department', form);
  const deptPermissions: string[] =
      departments?.find((d: any) => d.name === selectedDepartment)?.default_permissions || [];
  const deptHasAll = deptPermissions.includes('all');

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      message.success('使用者建立成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: any) => {
        message.error(error.response?.data?.detail || '建立失敗');
    }
  });

  const updateMutation = useMutation({
    mutationFn: updateUserById,
    onSuccess: () => {
      message.success('使用者更新成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: any) => {
        message.error(error.response?.data?.detail || '更新失敗');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      message.success('使用者刪除成功');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: any) => {
         message.error(error.response?.data?.detail || '刪除失敗');
    }
  });

  const handleEdit = (record: any) => {
    setEditingUser(record);
    form.setFieldsValue({
        ...record,
        extra_permissions: record.extra_permissions || [],
        password: '', // Don't fill password
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    form.resetFields();
  };

  const onFinish = (values: any) => {
    if (editingUser) {
        // Update
        updateMutation.mutate({ id: editingUser.id, data: values });
    } else {
        // Create
        createMutation.mutate(values);
    }
  };

  const columns = [
    {
      title: '使用者名稱 (Username)',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '姓名 (Full Name)',
      dataIndex: 'full_name',
      key: 'full_name',
    },
    {
      title: '部門 (Department)',
      dataIndex: 'department',
      key: 'department',
    },
    {
        title: '權限 (Permissions)',
        dataIndex: 'permissions',
        key: 'permissions',
        render: (perms: string[], record: any) => {
            const extras: string[] = record.extra_permissions || [];
            return (
                <div style={{ maxWidth: 360 }}>
                    {perms?.map(p => {
                        const isExtra = extras.includes(p);
                        return (
                            <Tag key={p} color={p === 'all' ? 'red' : isExtra ? 'orange' : 'blue'} style={{ marginBottom: 4 }}>
                                {p === 'all' ? '全部權限' : permissionLabel(p)}{isExtra ? '（額外）' : ''}
                            </Tag>
                        );
                    })}
                </div>
            );
        }
    },
    {
      title: '狀態',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive: boolean) => (
        isActive ? <Tag color="green">啟用</Tag> : <Tag color="default">停用</Tag>
      ),
    },
    {
        title: '操作',
        key: 'action',
        render: (_: any, record: any) => (
            <Space>
                <Button icon={<EditOutlined />} size="small" onClick={() => handleEdit(record)}>編輯</Button>
                <Popconfirm title="確定要刪除此使用者?" onConfirm={() => handleDelete(record.id)}>
                    <Button icon={<DeleteOutlined />} danger size="small">刪除</Button>
                </Popconfirm>
            </Space>
        )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Input 
            prefix={<SearchOutlined />} 
            placeholder="搜尋使用者..." 
            style={{ width: 200 }} 
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
          新增使用者
        </Button>
      </div>
      <Table 
        columns={columns} 
        dataSource={users} 
        rowKey="id" 
        loading={isLoading}
      />
      
      <Modal
        title={editingUser ? "編輯使用者" : "新增使用者"}
        open={isModalOpen}
        onCancel={handleCloseModal}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
            <Form.Item name="username" label="帳號" rules={[{ required: true }]}>
                <Input disabled={!!editingUser} />
            </Form.Item>
            <Form.Item name="full_name" label="姓名" rules={[{ required: true }]}>
                <Input />
            </Form.Item>
            <Form.Item name="department" label="部門" rules={[{ required: true }]}>
                 <Select placeholder="選擇部門" allowClear>
                    {departments?.map((d: any) => (
                        <Select.Option key={d.id} value={d.name}>{d.name}</Select.Option>
                    ))}
                 </Select>
            </Form.Item>
            <Form.Item
                name="extra_permissions"
                label="權限 (標「部門已有」的由部門決定，請至部門管理修改；其餘可單獨加給此帳號)"
                extra={!selectedDepartment ? '尚未選擇部門' : deptHasAll ? '部門已擁有全部權限，不需額外設定' : undefined}
            >
                <PermissionMatrix inherited={deptPermissions} />
            </Form.Item>
            <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
                <Input />
            </Form.Item>
            
            {!editingUser && (
                <>
                    <Form.Item name="password" label="密碼" rules={[{ required: true, min: 6 }]}>
                        <Input.Password />
                    </Form.Item>
                    <Typography.Text type="secondary" style={{ display: 'block', marginTop: -12, marginBottom: 16 }}>
                        新帳號一律會在第一次登入時被要求修改密碼，不需另外設定。
                    </Typography.Text>
                </>
            )}
            {editingUser && (
                <>
                    <Form.Item name="password" label="重設密碼 (留空則不修改)" rules={[{ min: 6 }]}>
                        <Input.Password placeholder="輸入新密碼以重設" />
                    </Form.Item>
                    <Form.Item name="force_password_change" valuePropName="checked">
                        <Checkbox>下次登入時強制修改密碼</Checkbox>
                    </Form.Item>
                </>
            )}
        </Form>
      </Modal>
    </div>
  );
};

const SystemSettings: React.FC = () => {
  // 從 LINE 開啟時隱藏跟 LINE 專用功能衝突、或在 LINE 內建瀏覽器用不了的功能（匯入／匯出等）
  const fromLine = isLiffMode();
  return (
    <div style={{ padding: '24px' }}>
      <Card title="系統設定">
        <Tabs defaultActiveKey="1">
          <TabPane tab="一般設定 (General)" key="1">
            <GeneralSettings />
          </TabPane>
          <TabPane tab="使用者管理 (User Management)" key="2">
             <UserManagement />
          </TabPane>
          <TabPane tab="部門管理 (Department Management)" key="3">
             <DepartmentManagement />
          </TabPane>
          <TabPane tab="LINE 通知 (LINE Notify)" key="4">
             {/* 在 LINE 裡解除綁定會讓自己馬上失去 LINE 的使用權，綁定／解除只在電腦上做 */}
             {!fromLine && <LineBindingSettings />}
             <LineRichMenuSync />
          </TabPane>
        </Tabs>
      </Card>
    </div>
  );
};

export default SystemSettings;
