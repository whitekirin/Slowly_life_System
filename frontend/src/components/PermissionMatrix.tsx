import React from 'react';
import { Checkbox, Table, Typography } from 'antd';
import { PERMISSION_GROUPS, PERMISSION_MODULES, SPECIAL_PERMISSIONS, grantsPermission, type PermissionGroup, type PermissionModule } from '../permissions';

interface Props {
  value?: string[];
  onChange?: (value: string[]) => void;
  /** 已經由部門給予的權限：顯示為勾選但不能改 */
  inherited?: string[];
  disabled?: boolean;
}

type Level = 'view' | 'create' | 'edit' | 'approve';
const LEVELS: Level[] = ['view', 'create', 'edit', 'approve'];

// 勾某個權限時要一起勾的：新增、修改／刪除都要能查看；核准要能修改／刪除
const REQUIRES: Record<Level, Level[]> = { view: [], create: ['view'], edit: ['view'], approve: ['edit', 'view'] };
// 取消某個權限時要一起取消的（REQUIRES 的反向）
const DEPENDENTS: Record<Level, Level[]> = { view: ['create', 'edit', 'approve'], create: [], edit: ['approve'], approve: [] };

const KNOWN = new Set<string>([
  ...PERMISSION_MODULES.flatMap(m => LEVELS.map(l => m[l]).filter(Boolean) as string[]),
  ...SPECIAL_PERMISSIONS.map(p => p.value),
]);

type Row =
  | { rowKey: string; kind: 'group'; group: PermissionGroup; children: Row[] }
  | { rowKey: string; kind: 'module'; module: PermissionModule };

// 依選單大標分組；只有一個功能的大標（儀表板、記帳）直接顯示該功能，不多一層
const ROWS: Row[] = PERMISSION_GROUPS.map(g => (
  g.modules.length === 1
    ? { rowKey: g.modules[0].key, kind: 'module' as const, module: g.modules[0] }
    : { rowKey: `group:${g.key}`, kind: 'group' as const, group: g, children: g.modules.map(m => ({ rowKey: m.key, kind: 'module' as const, module: m })) }
));

// 以「大標 › 功能 × 查看／新增／修改刪除／核准」勾選權限。勾高的會一起勾需要的低權限、取消低的會一起取消依賴它的；
// 大標那一列的勾選框一次設定整組。勾「全部權限」時其他全部鎖住，值只剩 ['all']。
const PermissionMatrix: React.FC<Props> = ({ value = [], onChange, inherited = [], disabled }) => {
  const hasAll = value.includes('all');
  const lockedAll = disabled || inherited.includes('all');

  // 不在目錄裡的舊權限值（例如 admin）原樣保留，避免編輯時被悄悄刪掉
  const emit = (next: string[]) => {
    const legacy = value.filter(p => !KNOWN.has(p));
    const known = next.filter(p => KNOWN.has(p));
    onChange?.(known.includes('all') ? ['all'] : [...legacy, ...known]);
  };

  const apply = (current: string[], m: PermissionModule, level: Level, checked: boolean) => {
    const perm = m[level];
    if (!perm) return current;
    const related = (checked ? REQUIRES : DEPENDENTS)[level].map(l => m[l]).filter(Boolean) as string[];
    if (checked) return [...new Set([...current, perm, ...related])];
    return current.filter(p => p !== perm && !related.includes(p));
  };

  const fromDept = (perm: string) => grantsPermission(inherited, perm);
  // 被同功能已勾的較高權限涵蓋（例如勾了新增，查看就一定有）
  const impliedByHigher = (m: PermissionModule, level: Level) =>
    DEPENDENTS[level].some(l => m[l] && value.includes(m[l]!));
  const isChecked = (m: PermissionModule, level: Level) => {
    const perm = m[level]!;
    return hasAll || fromDept(perm) || value.includes(perm) || impliedByHigher(m, level);
  };
  const isLocked = (m: PermissionModule, level: Level) =>
    lockedAll || hasAll || fromDept(m[level]!) || impliedByHigher(m, level);

  const renderModuleCell = (m: PermissionModule, level: Level) => {
    const perm = m[level];
    if (!perm) return <Typography.Text type="secondary">—</Typography.Text>;
    return (
      <Checkbox
        checked={isChecked(m, level)}
        disabled={isLocked(m, level)}
        onChange={e => emit(apply(value, m, level, e.target.checked))}
      >
        {fromDept(perm) ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>部門</Typography.Text> : null}
      </Checkbox>
    );
  };

  const renderGroupCell = (g: PermissionGroup, level: Level) => {
    const modules = g.modules.filter(m => m[level]);
    if (modules.length === 0) return null;
    const checkedCount = modules.filter(m => isChecked(m, level)).length;
    const editable = modules.filter(m => !isLocked(m, level));
    return (
      <Checkbox
        checked={checkedCount === modules.length}
        indeterminate={checkedCount > 0 && checkedCount < modules.length}
        disabled={editable.length === 0}
        onChange={e => emit(editable.reduce((acc, m) => apply(acc, m, level, e.target.checked), value))}
      />
    );
  };

  const cell = (level: Level) => (_: unknown, row: Row) =>
    row.kind === 'group' ? renderGroupCell(row.group, level) : renderModuleCell(row.module, level);

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 8 }}>
        {SPECIAL_PERMISSIONS.map(sp => {
          const dept = fromDept(sp.value);
          return (
            <Checkbox
              key={sp.value}
              checked={dept || value.includes(sp.value) || (sp.value !== 'all' && hasAll)}
              disabled={lockedAll || dept || (sp.value !== 'all' && hasAll)}
              onChange={e => emit(e.target.checked ? [...value, sp.value] : value.filter(p => p !== sp.value))}
            >
              <Typography.Text strong={sp.value === 'all'} type={sp.value === 'all' ? 'danger' : undefined}>{sp.label}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>（{dept ? '部門已有' : sp.description}）</Typography.Text>
            </Checkbox>
          );
        })}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <Table<Row>
          size="small"
          pagination={false}
          rowKey="rowKey"
          dataSource={ROWS}
          expandable={{ defaultExpandAllRows: true }}
          columns={[
            {
              title: '功能',
              key: 'label',
              render: (_: unknown, row: Row) => row.kind === 'group'
                ? <Typography.Text strong>{row.group.label}</Typography.Text>
                : (
                  <div>
                    <div>{row.module.label}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.module.description}</Typography.Text>
                  </div>
                ),
            },
            { title: '查看', key: 'view', width: 70, align: 'center', render: cell('view') },
            { title: '新增', key: 'create', width: 70, align: 'center', render: cell('create') },
            { title: '修改／刪除', key: 'edit', width: 100, align: 'center', render: cell('edit') },
            { title: '核准（簽呈）', key: 'approve', width: 100, align: 'center', render: cell('approve') },
          ]}
        />
      </div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
        出貨、退貨、進貨驗收會依單據自動記帳，不需要記帳權限；這些自動記帳一律記在系統日誌，並標註經手人有沒有記帳權限。
        記帳管理的新增／修改／刪除只有勾了對應權限的人能做（後端強制檢查，直接呼叫 API 也會被擋）。
      </Typography.Paragraph>
    </div>
  );
};

export default PermissionMatrix;
