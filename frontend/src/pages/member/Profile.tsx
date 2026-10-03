import React, { useState, useEffect } from 'react';
import { Form, Input, Button, DatePicker, Select, message, Descriptions, Tag, Divider } from 'antd';
import { useMember } from '../../contexts/MemberContext';
import { updateMemberProfile } from '../../memberApi';
import dayjs from 'dayjs';

const { Option } = Select;

const MemberProfile: React.FC = () => {
  const { member, refetchMember } = useMember();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (member) {
      form.setFieldsValue({
        ...member,
        birthday: member.birthday ? dayjs(member.birthday) : null,
      });
    }
  }, [member, form]);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      if (values.birthday) {
        values.birthday = values.birthday.format('YYYY-MM-DD');
      }
      await updateMemberProfile(values);
      message.success('資料更新成功 (Profile Updated)');
      setEditing(false);
      refetchMember();
    } catch (err) {
      message.error('更新失敗 (Update Failed)');
    } finally {
      setLoading(false);
    }
  };

  if (!member) return null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h3>會員資料 (Member Profile)</h3>
        {!editing && <Button type="primary" onClick={() => setEditing(true)}>編輯資料 (Edit)</Button>}
      </div>

      {!editing ? (
        <Descriptions bordered column={1}>
          <Descriptions.Item label="姓名 (Name)">{member.name}</Descriptions.Item>
          <Descriptions.Item label="會員等級 (Level)">
            <Tag color="gold">{member.level}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="累積點數 (Points)">{member.points} pts</Descriptions.Item>
          <Descriptions.Item label="手機號碼 (Phone)">{member.phone}</Descriptions.Item>
          <Descriptions.Item label="Email">{member.email || '-'}</Descriptions.Item>
          <Descriptions.Item label="性別 (Gender)">{member.gender || '-'}</Descriptions.Item>
          <Descriptions.Item label="生日 (Birthday)">{member.birthday ? dayjs(member.birthday).format('YYYY-MM-DD') : '-'}</Descriptions.Item>
          <Descriptions.Item label="LINE ID">{member.line_id || '-'}</Descriptions.Item>
          <Descriptions.Item label="加入時間 (Joined)">{dayjs(member.created_at).format('YYYY-MM-DD')}</Descriptions.Item>
        </Descriptions>
      ) : (
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={member}
        >
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="gender" label="性別">
            <Select>
              <Option value="Male">男</Option>
              <Option value="Female">女</Option>
              <Option value="Other">其他</Option>
            </Select>
          </Form.Item>
          <Form.Item name="birthday" label="生日">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="line_id" label="LINE ID">
            <Input />
          </Form.Item>
          
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="primary" htmlType="submit" loading={loading}>
              儲存 (Save)
            </Button>
            <Button onClick={() => setEditing(false)}>
              取消 (Cancel)
            </Button>
          </div>
        </Form>
      )}
    </div>
  );
};

export default MemberProfile;
