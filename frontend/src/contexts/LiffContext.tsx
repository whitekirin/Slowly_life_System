import React, { createContext, useContext, useEffect, useState } from 'react';
import liff from '@line/liff';
import { registerLiffIdTokenGetter } from '../liffApi';

interface LiffContextType {
  isReady: boolean;
  error: string | null;
  displayName: string | null;
}

const LiffContext = createContext<LiffContextType>({ isReady: false, error: null, displayName: null });

export const LiffProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const liffId = import.meta.env.VITE_LIFF_ID as string | undefined;
    if (!liffId) {
      setError('此功能尚未完成設定（缺少 LIFF_ID），請聯繫系統管理員');
      return;
    }

    let cancelled = false;

    liff
      .init({ liffId })
      .then(async () => {
        if (cancelled) return;
        if (!liff.isLoggedIn()) {
          liff.login();
          return; // liff.login() navigates away; nothing left to do here
        }
        registerLiffIdTokenGetter(() => liff.getIDToken());
        try {
          const profile = await liff.getProfile();
          if (!cancelled) setDisplayName(profile.displayName);
        } catch {
          // Profile is a nice-to-have; not having it shouldn't block the page.
        }
        if (!cancelled) setIsReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'LIFF 初始化失敗，請確認是否在 LINE 內開啟此頁面');
      });

    return () => {
      cancelled = true;
      registerLiffIdTokenGetter(null);
    };
  }, []);

  return (
    <LiffContext.Provider value={{ isReady, error, displayName }}>
      {children}
    </LiffContext.Provider>
  );
};

export const useLiff = () => useContext(LiffContext);
