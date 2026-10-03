import React from 'react';
import { Alert, Button, Spin } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useLiff } from '../../contexts/LiffContext';
import { createLiffSession } from '../../liffApi';
import { markLiffMode, safeStaffPath } from '../../liffSession';

// LINE 圖文選單／按鈕卡上沒有專用 LIFF 表單的功能都經過這裡：
// 用 LINE 身分換員工系統的 token（後端 POST /liff/session），再開後台的對應頁面。
const LiffGo: React.FC = () => {
  const { isReady, error: liffError } = useLiff();
  const [searchParams] = useSearchParams();
  const [error, setError] = React.useState<string | null>(null);
  const to = safeStaffPath(searchParams.get('to'));

  React.useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    createLiffSession()
      .then((data) => {
        if (cancelled) return;
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        markLiffMode();
        // 整頁重載，讓 App 重新讀 token（跟密碼登入後的做法一樣）
        window.location.replace(to);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.response?.data?.detail || '無法開啟系統，請稍後再試');
      });
    return () => {
      cancelled = true;
    };
  }, [isReady, to]);

  const message = liffError || error;
  if (message) {
    return (
      <div className="sl-liff-page">
        <Alert type="error" message="無法開啟此功能" description={message} showIcon />
        <Button style={{ marginTop: '1em' }} block size="large" href="/liff">回功能選單</Button>
      </div>
    );
  }

  return (
    <div className="sl-liff-page sl-liff-center">
      <Spin size="large" tip="正在開啟系統…">
        <div style={{ height: '5em' }} />
      </Spin>
    </div>
  );
};

export default LiffGo;
