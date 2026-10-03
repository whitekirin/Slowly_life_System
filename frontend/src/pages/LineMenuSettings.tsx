import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Popconfirm, Select, Space, Spin, Switch, Tag, Tooltip, Typography, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getLineMenuConfig, previewLineMenu, resetLineMenuConfig, saveLineMenuConfig,
  type LineMenuActionConfig, type LineMenuConfig, type LineMenuGroupConfig, type LinePaletteColor,
} from '../api';
import { permissionLabel } from '../permissions';

const { Title, Text } = Typography;

// LINE 圖文選單、聊天室按鈕卡、LIFF 首頁的外觀與排列（backend/line_menu_config.py）。
// 誰看得到哪個功能照系統權限，這頁不能改，只顯示出來讓人知道。

const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

// 還沒存的設定改完 400ms 才重畫預覽，避免每打一個字就打一次 API
const useDebounced = <T,>(value: T, delay: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

const Monogram: React.FC<{ text: string; colors: LinePaletteColor; muted?: boolean }> = ({ text, colors, muted }) => (
  <span className="sl-linecfg-mono" style={{ background: colors.tint, color: colors.ink, opacity: muted ? 0.5 : 1 }}>
    {text.slice(0, 1) || '・'}
  </span>
);

const LineMenuSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['line-menu-config'], queryFn: getLineMenuConfig });
  // 尚未儲存的編輯；null = 沒改過，直接顯示伺服器上的設定
  const [edits, setDraft] = useState<LineMenuConfig | null>(null);
  const [previewUserId, setPreviewUserId] = useState<number | null>(null);
  const draft = edits ?? data?.config ?? null;
  const dirty = !!edits && !!data && JSON.stringify(edits) !== JSON.stringify(data.config);
  const debouncedDraft = useDebounced(draft, 400);

  const preview = useQuery({
    queryKey: ['line-menu-preview', debouncedDraft, previewUserId],
    queryFn: () => previewLineMenu({ config: debouncedDraft!, userId: previewUserId }),
    enabled: !!debouncedDraft,
    placeholderData: (previous) => previous,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: saveLineMenuConfig,
    onSuccess: (result) => {
      queryClient.setQueryData(['line-menu-config'], { ...data!, config: result.config });
      setDraft(null);
      message.success('已儲存，所有綁定帳號的 LINE 選單會在背景更新（約幾秒到一分鐘）');
    },
    onError: (error: any) => message.error(error.response?.data?.detail || '儲存失敗'),
  });

  const resetMutation = useMutation({
    mutationFn: resetLineMenuConfig,
    onSuccess: (result) => {
      queryClient.setQueryData(['line-menu-config'], { ...data!, config: result.config });
      setDraft(null);
      message.success('已還原成預設，LINE 選單會在背景更新');
    },
    onError: (error: any) => message.error(error.response?.data?.detail || '還原失敗'),
  });

  const actionMeta = useMemo(() => Object.fromEntries((data?.actions || []).map((a) => [a.code, a])), [data]);

  if (isLoading || !data || !draft) {
    return <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>;
  }

  const palette = data.palette;
  const colorsOf = (code: string) => palette[code] || palette.brown;
  const groupLabel = (code: string) => draft.groups.find((g) => g.code === code)?.label || code;

  const updateGroup = (code: string, patch: Partial<LineMenuGroupConfig>) =>
    setDraft({ ...draft, groups: draft.groups.map((g) => (g.code === code ? { ...g, ...patch } : g)) });
  const updateAction = (code: string, patch: Partial<LineMenuActionConfig>) =>
    setDraft({ ...draft, actions: draft.actions.map((a) => (a.code === code ? { ...a, ...patch } : a)) });
  const moveGroup = (index: number, delta: number) => setDraft({ ...draft, groups: move(draft.groups, index, index + delta) });
  // 功能的順序是整張清單的相對位置：跟同組的上一個／下一個功能交換
  const moveAction = (code: string, delta: number) => {
    const index = draft.actions.findIndex((a) => a.code === code);
    const group = draft.actions[index].group;
    let target = index + delta;
    while (target >= 0 && target < draft.actions.length && draft.actions[target].group !== group) target += delta;
    if (target < 0 || target >= draft.actions.length) return;
    const next = [...draft.actions];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ ...draft, actions: next });
  };

  const whoCanSee = (code: string) => {
    const meta = actionMeta[code];
    if (!meta) return null;
    if (!meta.required_permissions.length) return <Tag>所有綁定的帳號</Tag>;
    return (
      <>
        {meta.required_permissions.map((p) => <Tag key={p}>{permissionLabel(p)}</Tag>)}
        {meta.allow_picker && <Tag>撿貨人員</Tag>}
      </>
    );
  };

  const groupOptions = draft.groups.map((g) => ({ value: g.code, label: g.label }));
  const previewUserOptions = [
    { value: -1, label: '不看權限（顯示所有開啟的功能）' },
    ...data.preview_users.map((u) => ({
      value: u.id,
      label: `${u.full_name || u.username}（${u.username}）${u.line_bound ? '・已綁定 LINE' : ''}`,
    })),
  ];

  return (
    <div className="sl-linecfg">
      <div className="sl-linecfg-head">
        <div>
          <Title level={2} style={{ margin: 0 }}>LINE 介面設定</Title>
          <Text type="secondary">調整 LINE 圖文選單、聊天室按鈕卡與 LINE 內操作首頁的名稱、顏色與順序。每個人看得到哪些功能，一律依照他在系統裡的權限。</Text>
        </div>
        <Space wrap>
          {dirty && <span className="sl-badge sl-badge--warn">有尚未儲存的變更</span>}
          <Popconfirm title="還原成系統預設的名稱、顏色與順序？" okText="還原" cancelText="取消" onConfirm={() => resetMutation.mutate()}>
            <Button icon={<UndoOutlined />} loading={resetMutation.isPending}>還原預設</Button>
          </Popconfirm>
          <Button disabled={!dirty} onClick={() => setDraft(null)}>放棄變更</Button>
          <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saveMutation.isPending} onClick={() => saveMutation.mutate(draft)}>
            儲存並更新 LINE 選單
          </Button>
        </Space>
      </div>

      <div className="sl-linecfg-layout">
        <div className="sl-linecfg-editor">
          <div className="sl-linecfg-section-head">
            <h3 className="sl-section-title">選單分組</h3>
            <span className="sl-section-note">每個分組在圖文選單上是一格；關掉的分組連同裡面的功能都不會出現在 LINE。</span>
          </div>

          {draft.groups.map((group, index) => {
            const colors = colorsOf(group.color);
            const actions = draft.actions.filter((a) => a.group === group.code);
            return (
              <section key={group.code} className={`sl-linecfg-group${group.enabled ? '' : ' is-off'}`} style={{ borderLeftColor: colors.accent }}>
                <div className="sl-linecfg-group-row">
                  <Monogram text={group.label} colors={colors} muted={!group.enabled} />
                  <div className="sl-linecfg-fields">
                    <Input
                      value={group.label}
                      maxLength={data.limits.group_label}
                      showCount
                      placeholder="分組名稱"
                      aria-label="分組名稱"
                      onChange={(e) => updateGroup(group.code, { label: e.target.value })}
                    />
                    <Input
                      value={group.subtitle}
                      maxLength={data.limits.subtitle}
                      showCount
                      placeholder="副標（可留空）"
                      aria-label="分組副標"
                      onChange={(e) => updateGroup(group.code, { subtitle: e.target.value })}
                    />
                  </div>
                  <Space size={4} className="sl-linecfg-tools">
                    <Tooltip title="往前移"><Button type="text" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => moveGroup(index, -1)} aria-label="分組往前移" /></Tooltip>
                    <Tooltip title="往後移"><Button type="text" icon={<ArrowDownOutlined />} disabled={index === draft.groups.length - 1} onClick={() => moveGroup(index, 1)} aria-label="分組往後移" /></Tooltip>
                    <Switch checked={group.enabled} onChange={(enabled) => updateGroup(group.code, { enabled })} checkedChildren="顯示" unCheckedChildren="隱藏" />
                  </Space>
                </div>

                <div className="sl-linecfg-swatches" role="radiogroup" aria-label="分組顏色">
                  {Object.entries(palette).map(([code, c]) => (
                    <Tooltip key={code} title={c.label}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={group.color === code}
                        aria-label={c.label}
                        className={`sl-linecfg-swatch${group.color === code ? ' is-on' : ''}`}
                        style={{ background: c.accent }}
                        onClick={() => updateGroup(group.code, { color: code })}
                      />
                    </Tooltip>
                  ))}
                </div>

                <div className="sl-linecfg-actions">
                  {actions.length === 0 && <Text type="secondary">這個分組目前沒有功能</Text>}
                  {actions.map((action, actionIndex) => (
                    <div key={action.code} className={`sl-linecfg-action${action.enabled ? '' : ' is-off'}`}>
                      <Input
                        value={action.label}
                        maxLength={data.limits.action_label}
                        placeholder={actionMeta[action.code]?.default_label}
                        aria-label="功能名稱"
                        onChange={(e) => updateAction(action.code, { label: e.target.value })}
                      />
                      <Select
                        value={action.group}
                        options={groupOptions}
                        aria-label="所屬分組"
                        onChange={(value) => updateAction(action.code, { group: value })}
                        popupMatchSelectWidth={false}
                      />
                      <Space size={2}>
                        <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={actionIndex === 0} onClick={() => moveAction(action.code, -1)} aria-label="功能往前移" />
                        <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={actionIndex === actions.length - 1} onClick={() => moveAction(action.code, 1)} aria-label="功能往後移" />
                        <Switch size="small" checked={action.enabled} onChange={(enabled) => updateAction(action.code, { enabled })} aria-label="顯示這個功能" />
                      </Space>
                      <div className="sl-linecfg-perm">
                        <Text type="secondary">誰看得到：</Text>{whoCanSee(action.code)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          <section className="sl-linecfg-group sl-linecfg-group--all">
            <div className="sl-linecfg-group-row">
              <span className="sl-linecfg-mono sl-linecfg-mono--all" aria-hidden>▦</span>
              <div className="sl-linecfg-fields">
                <Input
                  value={draft.all_tile.label}
                  maxLength={data.limits.group_label}
                  showCount
                  aria-label="「全部功能」磚塊名稱"
                  onChange={(e) => setDraft({ ...draft, all_tile: { ...draft.all_tile, label: e.target.value } })}
                />
                <Input
                  value={draft.all_tile.subtitle}
                  maxLength={data.limits.subtitle}
                  showCount
                  aria-label="「全部功能」磚塊副標"
                  onChange={(e) => setDraft({ ...draft, all_tile: { ...draft.all_tile, subtitle: e.target.value } })}
                />
              </div>
            </div>
            <Text type="secondary">圖文選單最後一格固定是這個磚塊，點了會打開 LINE 內的操作首頁。</Text>
          </section>
        </div>

        <aside className="sl-linecfg-preview">
          <div className="sl-linecfg-section-head">
            <h3 className="sl-section-title">預覽</h3>
            <span className="sl-section-note">尚未儲存的變更也會顯示在這裡</span>
          </div>
          <Select
            showSearch
            optionFilterProp="label"
            value={previewUserId ?? -1}
            options={previewUserOptions}
            onChange={(value) => setPreviewUserId(value === -1 ? null : value)}
            style={{ width: '100%' }}
            aria-label="預覽對象"
          />

          <div className="sl-linecfg-phone">
            <div className="sl-linecfg-chat">
              {preview.isError ? (
                <Text type="danger">{(preview.error as any)?.response?.data?.detail || '預覽產生失敗'}</Text>
              ) : !preview.data ? (
                <Spin />
              ) : !preview.data.groups.length ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="這個人在 LINE 沒有可用的功能，會看到預設選單" />
              ) : (
                <div className="sl-linecfg-bubbles">
                  {preview.data.groups.map((g) => (
                    <div key={g.code} className="sl-linecfg-bubble">
                      <div className="sl-linecfg-bubble-head" style={{ background: g.colors.tint }}>
                        <div style={{ color: g.colors.ink }} className="sl-linecfg-bubble-title">{g.label}</div>
                        {g.subtitle && <div className="sl-linecfg-bubble-sub">{g.subtitle}</div>}
                      </div>
                      <div className="sl-linecfg-bubble-body">
                        {g.actions.map((a) => (
                          <div key={a.code} className="sl-linecfg-bubble-row">
                            <span>{a.label}</span><span style={{ color: g.colors.accent }}>›</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {preview.data?.image && (
              <img
                className={`sl-linecfg-richmenu${preview.isFetching ? ' is-loading' : ''}`}
                src={preview.data.image}
                alt={`圖文選單預覽：${preview.data.tiles.map((t) => (t === 'all' ? draft.all_tile.label : groupLabel(t))).join('、')}`}
              />
            )}
            <div className="sl-linecfg-chatbar">功能選單 ▾</div>
          </div>
          <Text type="secondary" className="sl-linecfg-hint">上方是點了分組後收到的按鈕卡，下方是圖文選單。</Text>
        </aside>
      </div>
    </div>
  );
};

export default LineMenuSettings;
