import React, { createContext, useContext, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getUser } from '../api';
import { grantsPermission } from '../permissions';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  department: string;
  permissions: string[];
  is_active: boolean;
  is_superuser: boolean;
  settings?: any;
}

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  isError: boolean;
  hasPermission: (permission: string) => boolean;
  logout: () => void;
  refetchUser: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const token = localStorage.getItem('token');

  const { data: user, isLoading, isError, refetch } = useQuery({
    queryKey: ['user'],
    queryFn: getUser,
    enabled: !!token,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
  
  // Sync user to localStorage if successful (optional but good for consistency across tabs/reloads)
  useEffect(() => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    }
  }, [user]);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    queryClient.clear();
    window.location.href = '/login';
  };

  const hasPermission = (permission: string) => {
    if (!user || !user.permissions || !Array.isArray(user.permissions)) return false;
    return grantsPermission(user.permissions, permission);
  };

  return (
    <UserContext.Provider value={{ user: user || null, isLoading, isError, hasPermission, logout, refetchUser: refetch }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
