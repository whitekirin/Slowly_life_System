import React from 'react';
import { Alert, Empty, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useLiff } from '../../contexts/LiffContext';
import { getLiffActions } from '../../liffApi';

interface LiffActionSummary {
  code: string;
  label: string;
  liff_path: string;
  group: string;
  group_label: string;
  group_subtitle: string;
  group_colors: { accent: string; tint: string; ink: string };
}

interface LiffGroup {
  group: string;
  label: string;
  subtitle: string;
  colors: LiffActionSummary['group_colors'];
  actions: LiffActionSummary[];
}

// 後端已依「LINE 介面設定」的分組順序排好，這裡只把連續同組的收在一起
const groupActions = (actions: LiffActionSummary[]) =>
  actions.reduce<LiffGroup[]>((groups, action) => {
    const last = groups[groups.length - 1];
    if (last && last.group === action.group) last.actions.push(action);
    else groups.push({ group: action.group, label: action.group_label, subtitle: action.group_subtitle, colors: action.group_colors, actions: [action] });
    return groups;
  }, []);

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 11) return '早安';
  if (hour < 18) return '午安';
  return '晚安';
};

const LiffHome: React.FC = () => {
  const { isReady, error, displayName } = useLiff();
  const navigate = useNavigate();

  const { data: actions, isLoading } = useQuery<LiffActionSummary[]>({
    queryKey: ['liff-actions'],
    queryFn: getLiffActions,
    enabled: isReady,
  });

  if (error) {
    return (
      <div className="sl-liff-page">
        <Alert type="error" message="無法使用此功能" description={error} showIcon />
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="sl-liff-page sl-liff-center">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="sl-liff-page">
      <header className="sl-liff-hero">
        <div className="sl-liff-eyebrow">慢生活製造所</div>
        <h1 className="sl-liff-title">{displayName ? `${displayName}，${greeting()}` : greeting()}</h1>
        <p className="sl-liff-sub">今天要處理什麼？以下是你的權限能用的功能。</p>
      </header>

      {isLoading ? (
        <div className="sl-liff-center"><Spin /></div>
      ) : !actions?.length ? (
        <Empty style={{ marginTop: 32 }} description="目前沒有可在 LINE 使用的操作，如需協助請聯繫系統管理員" />
      ) : (
        <div className="sl-liff-groups">
        {groupActions(actions).map((group) => (
          <section key={group.group} className="sl-liff-group">
            <div className="sl-liff-group-head">
              <span className="sl-liff-mono" style={{ background: group.colors.tint, color: group.colors.ink }}>{group.label.slice(0, 1)}</span>
              <div>
                <h2 className="sl-liff-group-title">{group.label}</h2>
                {group.subtitle && <div className="sl-liff-group-sub">{group.subtitle}</div>}
              </div>
            </div>
            <div className="sl-liff-list">
              {group.actions.map((action) => (
                <button
                  key={action.code}
                  type="button"
                  className="sl-liff-row"
                  // liff_path 是相對 LIFF endpoint（/liff）的路徑
                  onClick={() => navigate(`/liff${action.liff_path}`)}
                >
                  <span>{action.label}</span>
                  <span className="sl-liff-chevron" style={{ color: group.colors.accent }} aria-hidden>›</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        </div>
      )}
    </div>
  );
};

export default LiffHome;
