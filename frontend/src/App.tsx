import React from "react";
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Spin,
  Badge,
  Grid,
} from "antd";
import {
  HomeOutlined,
  InboxOutlined,
  SendOutlined,
  AccountBookOutlined,
  LogoutOutlined,
  BellOutlined,
  AuditOutlined,
  SettingOutlined,
  ShoppingOutlined,
  TeamOutlined,
  ExportOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { UserProvider, useUser } from "./contexts/UserContext";
import Dashboard from "./pages/Dashboard";
import ProductList from "./pages/ProductList";
import CategoryList from "./pages/CategoryList";
import PurchaseOrderList from "./pages/PurchaseOrderList";
import Receiving from "./pages/Receiving";
import SupplementaryReceiving from "./pages/SupplementaryReceiving";
import SupplierList from "./pages/SupplierList";
import UserSettings from "./pages/UserSettings";
import SystemSettings from "./pages/SystemSettings";
import LineMenuSettings from "./pages/LineMenuSettings";
import SystemLogs from "./pages/SystemLogs";
import CreateUser from "./pages/CreateUser";
import Shipping from "./pages/Shipping";
import ReturnList from "./pages/ReturnList";
import StockTake from "./pages/StockTake";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Accounting from "./pages/Accounting";
import Notifications from "./pages/Notifications";
import ChangeRequests from "./pages/ChangeRequests";
import { PERMISSION_MODULES } from "./permissions";
import MarketingHub from "./pages/MarketingHub";
import ProductStatusManagement from "./pages/ProductStatusManagement";
import ProductListingResult from "./pages/ProductListingResult";
import { getUnreadNotificationCount, getPickerMe } from "./api";

import { MemberProvider } from "./contexts/MemberContext";
import MemberLogin from "./pages/member/Login";
import MemberRegister from "./pages/member/Register";
import MemberDashboard from "./pages/member/Dashboard";
import MemberList from "./pages/MemberList";
import MemberNewProducts from "./pages/MemberNewProducts";
import AdminDMList from "./pages/AdminDMList";
import MemberTheme from "./components/MemberTheme";

import { LiffProvider } from "./contexts/LiffContext";
import LiffTheme from "./components/LiffTheme";
import LiffHome from "./pages/liff/LiffHome";
import LiffGo from "./pages/liff/LiffGo";
import { isLiffMode } from "./liffSession";
import SlowLifeTheme from "./theme/SlowLifeTheme";
import { useViewport, fluidSiderWidth, fluidFontSize } from "./theme/useViewport";
import { useResponsiveTables } from "./theme/useResponsiveTables";

const { Header, Content, Footer, Sider } = Layout;

type MenuItem = Required<MenuProps>["items"][number];

function getItem(
  label: React.ReactNode,
  key: React.Key,
  icon?: React.ReactNode,
  children?: MenuItem[],
): MenuItem {
  return {
    key,
    icon,
    children,
    label,
  } as MenuItem;
}

// 每個路由的「我在哪裡」：選單 key、所屬分組、Header 顯示的頁名與一句話說明
interface RouteMeta { key: string; group?: string; groupLabel?: string; title: string; desc: string }
const G = {
  prod: { group: "sub_prod", groupLabel: "商品與庫存" },
  buy: { group: "sub1", groupLabel: "採購與進貨" },
  sell: { group: "sub2", groupLabel: "銷售與出貨" },
  fin: { group: "sub_finance", groupLabel: "財務" },
  mem: { group: "sub_members", groupLabel: "會員與行銷" },
  set: { group: "sub_settings", groupLabel: "設定" },
};
const ROUTE_META: Record<string, RouteMeta> = {
  "/": { key: "1", title: "總覽", desc: "今天的營運狀態，一眼看清楚" },
  "/notifications": { key: "notifications", title: "通知中心", desc: "系統提醒與訊息都整理在這裡" },
  "/change-requests": { key: "change_requests", title: "簽呈", desc: "需要送出或核准的變更申請" },
  "/products": { key: "2", ...G.prod, title: "商品列表", desc: "商品資料、價格與目前庫存" },
  "/product-status": { key: "product_status", ...G.prod, title: "上架批次", desc: "整理每一批準備上架的商品" },
  "/product-listing-result": { key: "product_status", ...G.prod, title: "上架批次明細", desc: "這一批商品的上架結果" },
  "/categories": { key: "3", ...G.prod, title: "類別管理", desc: "替商品分門別類" },
  "/stock-take": { key: "inventory_check", ...G.prod, title: "庫存盤點", desc: "清點實際數量，讓帳上庫存對得起來" },
  "/suppliers": { key: "4", ...G.buy, title: "供應商", desc: "合作夥伴的聯絡資料與評等" },
  "/purchase-orders": { key: "5", ...G.buy, title: "採購單", desc: "建立與追蹤向供應商的採購" },
  "/receiving": { key: "6", ...G.buy, title: "進貨驗收", desc: "核對到貨數量，讓庫存正式入帳" },
  "/supplementary-receiving": { key: "supplementary_receiving", ...G.buy, title: "補驗收單", desc: "短收之後補到的商品在這裡驗收" },
  "/shipping": { key: "7", ...G.sell, title: "出貨作業", desc: "訂單撿貨、出貨與物流" },
  "/returns": { key: "8", ...G.sell, title: "退貨作業", desc: "退貨退款與僅退款的處理" },
  "/accounting": { key: "finance_accounting", ...G.fin, title: "記帳管理", desc: "每月的收入、支出與損益" },
  "/members": { key: "members_list", ...G.mem, title: "會員列表", desc: "會員資料與點數" },
  "/members/new-products": { key: "members_new_products", ...G.mem, title: "新品總覽", desc: "新品上線與銷量表現" },
  "/admin/dms": { key: "admin_dms", ...G.mem, title: "推播管理（舊版）", desc: "舊版 DM 推播" },
  "/marketing": { key: "marketing_hub", ...G.mem, title: "行銷中心", desc: "推播活動與成效" },
  "/settings": { key: "9", ...G.set, title: "個人設定", desc: "你的帳號資料與密碼" },
  "/system-settings": { key: "10", ...G.set, title: "系統設定", desc: "通知、LINE 與系統參數" },
  "/line-menu-settings": { key: "line_menu_settings", ...G.set, title: "LINE 介面設定", desc: "LINE 選單的名稱、顏色與順序" },
  "/system-logs": { key: "system_logs", ...G.set, title: "系統日誌", desc: "系統操作紀錄" },
  "/users/create": { key: "10", ...G.set, title: "新增使用者", desc: "建立新的員工帳號" },
};
function findRouteMeta(pathname: string): RouteMeta {
  if (ROUTE_META[pathname]) return ROUTE_META[pathname];
  const prefix = Object.keys(ROUTE_META)
    .filter((p) => p !== "/" && pathname.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? ROUTE_META[prefix] : ROUTE_META["/"];
}

// 品牌記號：一道升起的光（「日子才有光」），線性、低細節
const BrandMark: React.FC = () => (
  <span className="sl-brand__mark" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6E5238" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 17h16" />
      <path d="M7.5 17a4.5 4.5 0 0 1 9 0" />
      <path d="M12 7.5v2M6.3 10.3l1.3 1.3M17.7 10.3l-1.3 1.3" />
    </svg>
  </span>
);

const AppLayout: React.FC = () => {
  // 手機（含從 LINE 圖文選單開進來的 LIFF）：側邊選單收成 0 寬，點左上的把手展開
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;
  const fromLine = isLiffMode();
  // 窄畫面的表格排成卡片（theme/useResponsiveTables.ts）
  useResponsiveTables();
  // 從 LINE 開進來（手機或平板）時內容優先：1200 以下先收起側欄，要用再點把手展開
  const [collapsed, setCollapsed] = React.useState(() => window.innerWidth < (fromLine ? 1200 : 768));
  // 側欄寬度、頭像大小跟著視窗寬度走
  const siderWidth = useViewport(fluidSiderWidth);
  const fs = useViewport(fluidFontSize);
  const { user, hasPermission, logout, isLoading } = useUser();
  const token = localStorage.getItem("token");
  const location = useLocation();
  const meta = findRouteMeta(location.pathname);
  // 展開中的分組只在側欄展開時受控；收合時交給 antd 自己管 hover 彈出，否則一載入就會彈出子選單
  const [openKeys, setOpenKeys] = React.useState<string[]>(meta.group ? [meta.group] : []);

  // Fetch unread notifications count
  const { data: unreadData } = useQuery({
    queryKey: ["notifications", "unread"],
    // 走 api.ts 的 axios instance（相對路徑＋自動帶 token），原本寫死 localhost:8000 在正式環境打不到
    queryFn: getUnreadNotificationCount,
    enabled: !!token,
    refetchInterval: 60000, // Check every minute
  });

  // 撿貨人員（含部門繼承）沒有 view_shipping 也要能進出貨作業的撿貨分頁
  const { data: pickerMe } = useQuery({
    queryKey: ["pickers", "me"],
    queryFn: getPickerMe,
    enabled: !!token,
  });
  const canOpenShipping = hasPermission("view_shipping") || !!pickerMe?.is_picker;

  const handleOpenMemberSystem = () => {
    try {
      if (!token) {
        throw new Error("Missing authentication token");
      }
      // Encrypt/sign parameters (using btoa for demonstration purposes, real app would use proper encryption/signing)
      const payload = JSON.stringify({
        token: token,
        timestamp: Date.now(),
        source: 'erp_admin'
      });
      // Convert to Base64 to simulate encrypted param
      const secureParam = btoa(unescape(encodeURIComponent(payload)));
      
      // Open in new tab
      window.open(`/member/login?auth=${secureParam}`, '_blank');
    } catch (error) {
      console.error("Failed to open member system:", error);
      alert("無法開啟會員系統：驗證失敗");
    }
  };

  const items: MenuItem[] = [
    hasPermission("view_dashboard") &&
      getItem(<Link to="/">總覽</Link>, "1", <HomeOutlined />),

    // Notifications
    getItem(
      <Link to="/notifications">通知中心</Link>,
      "notifications",
      <BellOutlined />,
    ),

    // 簽呈：能對某個有核准流程的功能送簽呈（有編輯權限）或核准的人才看得到
    PERMISSION_MODULES.some((m) => m.approve && m.edit && hasPermission(m.edit)) &&
      getItem(<Link to="/change-requests">簽呈</Link>, "change_requests", <AuditOutlined />),

    // Products Group
    (hasPermission("view_products") || hasPermission("view_product_listings") || hasPermission("view_categories") || hasPermission("view_stock_takes")) &&
      getItem(
        "商品與庫存",
        "sub_prod",
        <InboxOutlined />,
        [
          hasPermission("view_products") &&
            getItem(<Link to="/products">商品列表</Link>, "2"),
          hasPermission("view_product_listings") &&
            getItem(<Link to="/product-status">上架批次</Link>, "product_status"),
          hasPermission("view_categories") &&
            getItem(<Link to="/categories">類別管理</Link>, "3"),
          hasPermission("view_stock_takes") &&
            getItem(<Link to="/stock-take">庫存盤點</Link>, "inventory_check"),
        ].filter(Boolean) as MenuItem[],
      ),

    // Purchasing Group
    (hasPermission("view_suppliers") ||
      hasPermission("view_purchase_orders") ||
      hasPermission("view_receiving") ||
      hasPermission("view_supplementary_receivings")) &&
      getItem(
        "採購與進貨",
        "sub1",
        <ShoppingOutlined />,
        [
          hasPermission("view_suppliers") &&
            getItem(<Link to="/suppliers">供應商</Link>, "4"),
          hasPermission("view_purchase_orders") &&
            getItem(<Link to="/purchase-orders">採購單</Link>, "5"),
          hasPermission("view_receiving") &&
            getItem(<Link to="/receiving">進貨驗收</Link>, "6"),
          hasPermission("view_supplementary_receivings") &&
            getItem(<Link to="/supplementary-receiving">補驗收單</Link>, "supplementary_receiving"),
        ].filter(Boolean) as MenuItem[],
      ),

    // Sales Group
    (canOpenShipping || hasPermission("view_returns")) &&
      getItem(
        "銷售與出貨",
        "sub2",
        <SendOutlined />,
        [
          canOpenShipping &&
            getItem(<Link to="/shipping">出貨作業</Link>, "7"),
          hasPermission("view_returns") &&
            getItem(<Link to="/returns">退貨作業</Link>, "8"),
        ].filter(Boolean) as MenuItem[],
      ),

    // Finance Group
    hasPermission("view_finance") &&
      getItem(
        "財務",
        "sub_finance",
        <AccountBookOutlined />,
        [
          getItem(<Link to="/accounting">記帳管理</Link>, "finance_accounting"),
        ].filter(Boolean) as MenuItem[],
      ),

    // Member Group
    (hasPermission("view_members") || hasPermission("view_new_products") || hasPermission("view_dms") || hasPermission("view_marketing")) &&
      getItem(
        "會員與行銷",
        "sub_members",
        <TeamOutlined />,
        [
          hasPermission("view_members") && getItem(<Link to="/members">會員列表</Link>, "members_list"),
          hasPermission("view_new_products") && getItem(<Link to="/members/new-products">新品總覽</Link>, "members_new_products"),
          hasPermission("view_dms") && getItem(<Link to="/admin/dms">推播管理（舊版）</Link>, "admin_dms"),
          hasPermission("view_marketing") && getItem(<Link to="/marketing">行銷中心</Link>, "marketing_hub"),
          // 會另開新視窗，LINE 內建瀏覽器不好用
          hasPermission("edit_members") && !fromLine && getItem(<span onClick={handleOpenMemberSystem} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}>開啟會員系統 <ExportOutlined /></span>, "open_member_system"),
        ].filter(Boolean) as MenuItem[]
      ),

    // Settings Group
    getItem(
      "設定",
      "sub_settings",
      <SettingOutlined />,
      [
        getItem(<Link to="/settings">個人設定</Link>, "9"),
        hasPermission("manage_system") &&
          getItem(<Link to="/system-settings">系統設定</Link>, "10"),
        hasPermission("manage_system") &&
          getItem(<Link to="/line-menu-settings">LINE 介面設定</Link>, "line_menu_settings"),
        (hasPermission("view_system_logs") || hasPermission("admin")) &&
          getItem(<Link to="/system-logs">系統日誌</Link>, "system_logs"),
      ].filter(Boolean) as MenuItem[],
    ),
  ].filter(Boolean) as MenuItem[];

  const userMenu: MenuProps["items"] = [
    { key: "1", label: <Link to="/settings">個人設定</Link>, icon: <SettingOutlined /> },
    { type: "divider" },
    { key: "2", label: "登出", icon: <LogoutOutlined />, onClick: logout },
  ];

  const displayName = user?.full_name || user?.username || "使用者";

  if (isLoading && token) {
    return (
      <div className="sl-loading">
        <div className="sl-loading__inner">
          <Spin size="large" />
          正在整理你的工作台…
        </div>
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        className={`sl-sider${collapsed ? " sl-sider--collapsed" : ""}`}
        width={siderWidth}
        collapsible
        collapsed={collapsed}
        // 斷點變化時 antd 會同時呼叫 onBreakpoint 和 onCollapse(…, "responsive")；
        // 斷點交給 onBreakpoint 處理（含 LINE 模式平板先收合），這裡只理會使用者點把手
        onCollapse={(value, type) => { if (type !== "responsive") setCollapsed(value); }}
        breakpoint="md"
        collapsedWidth={isMobile ? 0 : Math.round(fs * 5.4)}
        onBreakpoint={(broken) => setCollapsed(broken || (fromLine && window.innerWidth < 1200))}
      >
        <div className="sl-brand">
          <BrandMark />
          {!collapsed && (
            <div>
              <div className="sl-brand__name">慢生活製造所</div>
              <div className="sl-brand__sub">電商管理</div>
            </div>
          )}
        </div>
        <div className="sl-sider__menu">
          <Menu
            mode="inline"
            selectedKeys={[meta.key]}
            {...(collapsed ? {} : { openKeys, onOpenChange: setOpenKeys })}
            items={items}
            onClick={() => isMobile && setCollapsed(true)}
          />
        </div>
        {!collapsed && (
          <div className="sl-sider__foot">
            慢下來，好好生活。
            <br />
            為生活留一點空白，
            <br />
            日子才有光。
          </div>
        )}
      </Sider>
      <Layout style={{ minWidth: 0 }}>
        <Header className="sl-header">
          <div className="sl-header__where">
            <div className="sl-header__crumb">
              {meta.groupLabel ? <>{meta.groupLabel}<span className="sl-header__sep">/</span><b>{meta.title}</b></> : <b>{meta.title}</b>}
            </div>
            <div className="sl-header__desc">{meta.desc}</div>
          </div>
          <div className="sl-header__actions">
            {fromLine && (
              <a href="/liff" title="回 LINE 功能選單" className="sl-icon-btn">
                <AppstoreOutlined />
              </a>
            )}
            <Link to="/notifications" title="通知中心" className="sl-icon-btn">
              <Badge count={unreadData?.count || 0} size="small" offset={[2, -2]}>
                <BellOutlined style={{ fontSize: 18, color: "inherit" }} />
              </Badge>
            </Link>
            <Dropdown menu={{ items: userMenu }} placement="bottomRight">
              <div className="sl-user">
                <Avatar className="sl-user__avatar" size={Math.round(fs * 2.3)}>
                  {displayName.slice(0, 1)}
                </Avatar>
                {!isMobile && <span className="sl-user__name">{displayName}</span>}
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content className="sl-main">
          <div className="sl-surface">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/products" element={<ProductList />} />
              <Route path="/product-status" element={<ProductStatusManagement />} />
              <Route path="/product-listing-result/:batchId" element={<ProductListingResult />} />
              <Route path="/categories" element={<CategoryList />} />
              <Route path="/suppliers" element={<SupplierList />} />
              <Route path="/purchase-orders" element={<PurchaseOrderList />} />
              <Route path="/receiving" element={<Receiving />} />
              <Route path="/supplementary-receiving" element={<SupplementaryReceiving />} />
              <Route path="/shipping" element={<Shipping />} />
              <Route path="/returns" element={<ReturnList />} />
              <Route path="/stock-take" element={<StockTake />} />
              <Route path="/accounting" element={<Accounting />} />
              <Route path="/members" element={<MemberList />} />
              <Route path="/members/new-products" element={<MemberNewProducts />} />
              <Route path="/admin/dms" element={<AdminDMList />} />
              <Route path="/marketing" element={<MarketingHub />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/change-requests" element={<ChangeRequests />} />
              <Route path="/settings" element={<UserSettings />} />
              <Route path="/system-settings" element={<SystemSettings />} />
              <Route path="/line-menu-settings" element={<LineMenuSettings />} />
              <Route path="/system-logs" element={<SystemLogs />} />
              <Route path="/users/create" element={<CreateUser />} />
            </Routes>
          </div>
        </Content>
        <Footer className="sl-footer">
          慢生活製造所 · 把繁忙的工作整理得井然有序
        </Footer>
      </Layout>
    </Layout>
  );
};

const queryClient = new QueryClient();

const App: React.FC = () => {
  const token = localStorage.getItem("token");

  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <MemberProvider>
          <Router>
            <Routes>
              <Route path="/member/login" element={<MemberTheme><MemberLogin /></MemberTheme>} />
              <Route path="/member/register" element={<MemberTheme><MemberRegister /></MemberTheme>} />
              <Route path="/member/dashboard" element={<MemberTheme><MemberDashboard /></MemberTheme>} />
              <Route path="/liff" element={<LiffTheme><LiffProvider><LiffHome /></LiffProvider></LiffTheme>} />
              <Route path="/liff/go" element={<LiffTheme><LiffProvider><LiffGo /></LiffProvider></LiffTheme>} />
              <Route path="/reset-password" element={<SlowLifeTheme><ResetPassword /></SlowLifeTheme>} />
              <Route path="/login" element={<SlowLifeTheme><Login /></SlowLifeTheme>} />
              <Route path="/*" element={<SlowLifeTheme>{token ? <AppLayout /> : <Login />}</SlowLifeTheme>} />
          </Routes>
        </Router>
        </MemberProvider>
      </UserProvider>
    </QueryClientProvider>
  );
};

export default App;
