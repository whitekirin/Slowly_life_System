import React, { useState } from 'react';
import { List, Card, Button, Form, Input, Modal, message, Tag, Checkbox, Spin, Empty } from 'antd';
import { PlusOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMemberAddresses, addMemberAddress } from '../../memberApi';

const MemberAddresses: React.FC = () => {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: addresses, isLoading } = useQuery({
    queryKey: ['member_addresses'],
    queryFn: getMemberAddresses,
  });

  const mutation = useMutation({
    mutationFn: addMemberAddress,
    onSuccess: () => {
      message.success('地址新增成功 (Address Added)');
      setIsModalVisible(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['member_addresses'] });
    },
    onError: () => {
      message.error('新增失敗 (Add Failed)');
    },
  });

  const handleAdd = (values: any) => {
    mutation.mutate(values);
  };

  if (isLoading) return <div style={{ textAlign: 'center', padding: 50 }}><Spin size="large" /></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3>地址簿 (Address Book)</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
          新增地址 (Add New)
        </Button>
      </div>

      {!addresses || addresses.length === 0 ? (
        <Empty description="尚無地址 (No addresses)" />
      ) : (
        <List
          grid={{ gutter: 16, column: 2 }}
          dataSource={addresses}
          renderItem={(item: any) => (
            <List.Item>
              <Card 
                title={item.recipient_name} 
                extra={item.is_default && <Tag color="blue">預設 (Default)</Tag>}
                actions={[<Button type="link">編輯</Button>, <Button type="link" danger>刪除</Button>]}
              >
                <p><EnvironmentOutlined /> {item.address}</p>
                <p>Tel: {item.recipient_phone}</p>
              </Card>
            </List.Item>
          )}
        />
      )}

      <Modal
        title="新增收件地址 (Add Address)"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAdd}
          initialValues={{ is_default: false }}
        >
          <Form.Item name="recipient_name" label="收件人姓名 (Name)" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="recipient_phone" label="收件人電話 (Phone)" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="address" label="詳細地址 (Address)" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="is_default" valuePropName="checked">
            <Checkbox>設為預設地址 (Set as Default)</Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={mutation.isPending}>
            提交 (Submit)
          </Button>
        </Form>
      </Modal>
    </div>
  );
};

export default MemberAddresses;
