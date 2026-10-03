import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMemberProfile } from '../memberApi';

export interface Member {
  id: number;
  name: string;
  phone: string;
  email?: string;
  level: string;
  points: number;
  is_active: boolean;
  gender?: string;
  birthday?: string;
  line_id?: string;
  created_at?: string;
  addresses?: any[];
  orders?: any[];
}

interface MemberContextType {
  member: Member | null;
  isLoading: boolean;
  isError: boolean;
  logout: () => void;
  refetchMember: () => void;
}

const MemberContext = createContext<MemberContextType | undefined>(undefined);

export const MemberProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('member_token'));

  useEffect(() => {
    const syncAuthToken = () => {
      setToken(localStorage.getItem('member_token'));
    };

    window.addEventListener('storage', syncAuthToken);
    window.addEventListener('member-auth-changed', syncAuthToken as EventListener);

    return () => {
      window.removeEventListener('storage', syncAuthToken);
      window.removeEventListener('member-auth-changed', syncAuthToken as EventListener);
    };
  }, []);

  const { data: member, isLoading, isError, refetch } = useQuery({
    queryKey: ['member'],
    queryFn: getMemberProfile,
    enabled: !!token,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    // #region debug-point C:provider-render
    fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"member-login-redirect",runId:"post-fix",hypothesisId:"C",location:"frontend/src/contexts/MemberContext.tsx:provider-render",msg:"[DEBUG] member provider state snapshot",data:{hasToken:!!token,isLoading,isError,hasMember:!!member,memberId:member?.id ?? null,currentPath:window.location.pathname},ts:Date.now()})}).catch(()=>{});
    // #endregion
  }, [token, isLoading, isError, member]);
  
  // Sync member to localStorage if successful
  useEffect(() => {
    if (member) {
      localStorage.setItem('member', JSON.stringify(member));
    }
  }, [member]);

  const logout = () => {
    localStorage.removeItem('member_token');
    localStorage.removeItem('member');
    queryClient.removeQueries({ queryKey: ['member'] });
    window.dispatchEvent(new Event('member-auth-changed'));
    window.location.href = '/member/login';
  };

  return (
    <MemberContext.Provider value={{ member: member || null, isLoading, isError, logout, refetchMember: refetch }}>
      {children}
    </MemberContext.Provider>
  );
};

export const useMember = () => {
  const context = useContext(MemberContext);
  if (context === undefined) {
    throw new Error('useMember must be used within a MemberProvider');
  }
  return context;
};
