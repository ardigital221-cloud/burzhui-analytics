import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileImage,
  Filter,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  TrendingUp,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Avatar, AvatarFallback } from "@/components/reui/avatar";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/reui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/reui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/reui/dialog";
import { Input } from "@/components/reui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/reui/native-select";
import { Progress } from "@/components/reui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/reui/sheet";
import { Skeleton } from "@/components/reui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/reui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/reui/tabs";
import { Textarea } from "@/components/reui/textarea";
import { cn } from "@/lib/utils";

type Role = "developer" | "supervisor" | "manager" | "employee";
type TaskStatus = "new" | "in_progress" | "review" | "done";
type TaskPriority = "low" | "normal" | "high" | "urgent";
type View = "overview" | "tasks" | "team" | "analytics" | "profile";

type User = {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  department_id: string | null;
  department_name: string | null;
  department_ids?: string[];
  all_departments?: boolean;
  iiko_employee_name: string | null;
  iiko_employee_code: string | null;
  active: boolean;
};

type Department = { id: string; name: string };
type Comment = {
  id: string | number;
  body: string;
  user_name?: string;
  author_name?: string;
  created_at: string;
  kind?: string;
};
type Attachment = {
  id: string | number;
  mime_type?: string;
  filename?: string;
  created_at: string;
};
type Task = {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  department_id: string | null;
  department_name: string | null;
  creator_id: string;
  creator_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  comments?: Comment[];
  attachments?: Attachment[];
};

type SalesData = {
  kpi?: {
    totalRevenue?: number;
    totalOrders?: number;
    totalDishes?: number;
    avgCheck?: number;
    daysCount?: number;
  };
  daily?: {
    date?: string;
    revenue?: number;
    orders?: number;
    dishes?: number;
  }[];
  upsell?: {
    drinkRatioQty?: string;
    drinkRatioRev?: string;
    addonRatioQty?: string;
    addonRatioRev?: string;
    upsellShare?: string;
    totalUpsellRev?: number;
  };
  payments?: { paymentType?: string; revenue?: number; amount?: number }[];
  topDishes?: {
    dishName?: string;
    name?: string;
    revenue?: number;
    amount?: number;
    quantity?: number;
  }[];
  hourly?: { hour?: string | number; revenue?: number; orders?: number }[];
  cashiers?: {
    name?: string;
    cashierName?: string;
    revenue?: number;
    orders?: number;
    drinkRate?: string;
    addonRate?: string;
    upsellShare?: string;
  }[];
};

type RankingRow = {
  departmentName?: string;
  name?: string;
  revenue?: number;
  totalRevenue?: number;
  orders?: number;
};
type Shift = {
  id?: string | number;
  sessionNumber?: string | number;
  status?: string;
  openDate?: string;
  closeDate?: string;
  manager?: string;
  responsible?: string;
  payOrders?: number;
  salesCash?: number;
  salesCard?: number;
  cashDiff?: number;
};

const navItems: {
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
}[] = [
  {
    id: "overview",
    label: "Обзор",
    icon: LayoutDashboard,
    roles: ["developer", "supervisor", "manager", "employee"],
  },
  {
    id: "tasks",
    label: "Задачи",
    icon: ClipboardCheck,
    roles: ["developer", "supervisor", "manager", "employee"],
  },
  {
    id: "team",
    label: "Команда",
    icon: Users,
    roles: ["developer", "manager"],
  },
  {
    id: "analytics",
    label: "Аналитика",
    icon: BarChart3,
    roles: ["developer", "supervisor", "manager"],
  },
  {
    id: "profile",
    label: "Профиль",
    icon: UserRound,
    roles: ["developer", "supervisor", "manager", "employee"],
  },
];

const statusLabels: Record<TaskStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  review: "На проверке",
  done: "Готово",
};
const priorityLabels: Record<TaskPriority, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный",
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401)
    window.dispatchEvent(new Event("burzhui:session-expired"));
  if (!response.ok)
    throw new Error(data?.error || "Не удалось выполнить запрос");
  return data as T;
}

function jsonBody(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}
function formatMoney(value = 0) {
  return (
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
      Number(value || 0),
    ) + " ₸"
  );
}
function formatNumber(value = 0) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
    Number(value || 0),
  );
}
function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(
    "ru-RU",
    withTime
      ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short" },
  ).format(date);
}
function initials(name?: string | null) {
  return (name || "Б")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Что-то пошло не так";
}

function numberValue(...values: unknown[]) {
  const value = values.find(
    (candidate) =>
      candidate !== undefined && candidate !== null && candidate !== "",
  );
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(...values: unknown[]) {
  const value = values.find(
    (candidate) =>
      candidate !== undefined && candidate !== null && candidate !== "",
  );
  return value === undefined ? "" : String(value);
}

function isNetworkRole(role: Role) {
  return role === "developer" || role === "supervisor";
}

function userDepartmentIds(user: Pick<User, "department_id" | "department_ids">) {
  const ids = Array.isArray(user.department_ids)
    ? user.department_ids.filter(Boolean)
    : [];
  return ids.length || !user.department_id ? ids : [user.department_id];
}

function hasDepartment(user: User, departmentId?: string | null) {
  return Boolean(user.all_departments) || Boolean(departmentId && userDepartmentIds(user).includes(departmentId));
}

function departmentsForUser(user: User, departments: Department[]) {
  if (isNetworkRole(user.role) || user.all_departments) return departments;
  const ids = userDepartmentIds(user);
  return departments.filter((department) => ids.includes(department.id));
}

function departmentLabel(user: User, departments: Department[]) {
  if (user.all_departments || isNetworkRole(user.role)) return "Вся сеть";
  const scoped = departmentsForUser(user, departments);
  if (scoped.length) return scoped.map((item) => item.name).join(", ");
  return user.department_name || "Точки не назначены";
}

function departmentParamForUser(user: User) {
  if (isNetworkRole(user.role) || user.all_departments || userDepartmentIds(user).length > 1) return "ALL";
  return userDepartmentIds(user)[0] || "";
}

function normalizeMyMetrics(raw: Record<string, unknown>): SalesData {
  const revenue = numberValue(raw.revenue, raw.totalRevenue);
  const orders = numberValue(raw.orders, raw.totalOrders);
  return {
    kpi: {
      totalRevenue: revenue,
      totalOrders: orders,
      totalDishes: 0,
      avgCheck: numberValue(raw.avgCheck, orders ? revenue / orders : 0),
      daysCount: 0,
    },
    upsell: {
      drinkRatioQty: textValue(raw.drinkRate, raw.drinkRatioQty, "0"),
      drinkRatioRev: textValue(raw.drinkRatioRev, "0"),
      addonRatioQty: textValue(raw.addonRate, raw.addonRatioQty, "0"),
      addonRatioRev: textValue(raw.addonRatioRev, "0"),
      upsellShare: textValue(raw.upsellShare, "0"),
      totalUpsellRev: numberValue(raw.totalUpsellRev),
    },
    daily: [],
    payments: [],
    hourly: [],
    topDishes: [],
    cashiers: [],
  };
}

function normalizeSales(raw: Record<string, unknown>): SalesData {
  const rows = (key: string) =>
    Array.isArray(raw[key]) ? (raw[key] as Record<string, unknown>[]) : [];
  const daily = rows("daily").map((row) => ({
    date: textValue(row.date, row["OpenDate.Typed"]),
    revenue: numberValue(row.revenue, row.DishDiscountSumInt),
    orders: numberValue(row.orders, row.UniqOrderId),
    dishes: numberValue(row.dishes, row.DishAmountInt),
  }));
  const rawKpi = (raw.kpi || {}) as Record<string, unknown>;
  const revenue = numberValue(
    rawKpi.totalRevenue,
    rawKpi.DishDiscountSumInt,
    daily.reduce((sum, row) => sum + numberValue(row.revenue), 0),
  );
  const orders = numberValue(
    rawKpi.totalOrders,
    rawKpi.UniqOrderId,
    daily.reduce((sum, row) => sum + numberValue(row.orders), 0),
  );
  const dishes = numberValue(
    rawKpi.totalDishes,
    rawKpi.DishAmountInt,
    daily.reduce((sum, row) => sum + numberValue(row.dishes), 0),
  );
  const topDishes = rows("topDishes").map((row) => ({
    dishName: textValue(row.dishName, row.DishName, row.name),
    revenue: numberValue(row.revenue, row.DishDiscountSumInt),
    amount: numberValue(row.amount, row.DishAmountInt),
    quantity: numberValue(row.quantity, row.DishAmountInt),
  }));
  const cashiers = rows("cashiers").map((row) => ({
    name: textValue(row.name, row.cashierName, row.Cashier, "Не указан"),
    revenue: numberValue(row.revenue, row.DishDiscountSumInt),
    orders: numberValue(row.orders, row.UniqOrderId),
    drinkRate: textValue(row.drinkRate, "0"),
    addonRate: textValue(row.addonRate, "0"),
    upsellShare: textValue(row.upsellShare, row.drinkRate, "0"),
  }));
  const payments = rows("payments").map((row) => ({
    paymentType: textValue(
      row.paymentType,
      row.PaymentType,
      row.PayType,
      row.PayTypes,
      row["PayTypes.Name"],
      row.name,
      "Не указан",
    ),
    revenue: numberValue(row.revenue, row.DishDiscountSumInt),
    amount: numberValue(row.amount, row.DishDiscountSumInt),
  }));
  const hourly = rows("hourly").map((row) => ({
    hour: textValue(row.hour, row["OpenTime.Minutes15"]),
    revenue: numberValue(row.revenue, row.DishDiscountSumInt),
    orders: numberValue(row.orders, row.UniqOrderId),
  }));
  const rawUpsell = (raw.upsell || {}) as Record<string, unknown>;
  return {
    kpi: {
      totalRevenue: revenue,
      totalOrders: orders,
      totalDishes: dishes,
      avgCheck: numberValue(
        rawKpi.avgCheck,
        rawKpi["DishDiscountSumInt.average"],
        orders ? revenue / orders : 0,
      ),
      daysCount: numberValue(rawKpi.daysCount, daily.length),
    },
    daily,
    upsell: {
      ...rawUpsell,
      drinkRatioQty: textValue(
        rawUpsell.drinkRatioQty,
        rawUpsell.drinkRate,
        "0",
      ),
      drinkRatioRev: textValue(rawUpsell.drinkRatioRev, "0"),
      addonRatioQty: textValue(
        rawUpsell.addonRatioQty,
        rawUpsell.addonRate,
        "0",
      ),
      addonRatioRev: textValue(rawUpsell.addonRatioRev, "0"),
      upsellShare: textValue(rawUpsell.upsellShare, "0"),
      totalUpsellRev: numberValue(rawUpsell.totalUpsellRev),
    },
    payments,
    topDishes,
    hourly,
    cashiers,
  };
}

function normalizeRanking(rows: unknown): RankingRow[] {
  if (rows && !Array.isArray(rows) && typeof rows === "object") {
    const wrapper = rows as Record<string, unknown>;
    rows = wrapper.ranking || wrapper.rows || [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      departmentName: textValue(
        item.departmentName,
        item.Department,
        item["Department.Name"],
        item.name,
      ),
      name: textValue(item.name, item.Department, item["Department.Name"]),
      revenue: numberValue(
        item.revenue,
        item.totalRevenue,
        item.DishDiscountSumInt,
      ),
      totalRevenue: numberValue(
        item.totalRevenue,
        item.revenue,
        item.DishDiscountSumInt,
      ),
      orders: numberValue(item.orders, item.UniqOrderId),
    };
  });
}

function normalizeShifts(rows: unknown): Shift[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      id: item.id as string | number | undefined,
      sessionNumber: item.sessionNumber as string | number | undefined,
      status: textValue(item.status, item.sessionStatus),
      openDate: textValue(item.openDate, item.opened_at, item.date),
      closeDate: textValue(item.closeDate, item.closed_at),
      manager: textValue(item.manager),
      responsible: textValue(item.responsible),
      payOrders: numberValue(item.payOrders, item.orders),
      salesCash: numberValue(item.salesCash, item.cash),
      salesCard: numberValue(item.salesCard, item.card),
      cashDiff: numberValue(item.cashDiff),
    };
  });
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<{ success: boolean; user: User }>("/api/auth/me")
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    const expire = () => {
      setUser(null);
      setView("overview");
      setAuthError("Сессия завершена. Войдите снова.");
    };
    window.addEventListener("burzhui:session-expired", expire);
    return () => window.removeEventListener("burzhui:session-expired", expire);
  }, []);

  const login = async (username: string, password: string) => {
    setAuthError("");
    try {
      const result = await api<{ success: boolean; user: User }>(
        "/api/auth/login",
        jsonBody({ username, password }),
      );
      setUser(result.user);
      setView("overview");
    } catch (error) {
      setAuthError(errorText(error));
    }
  };
  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setView("overview");
    }
  };
  const go = (next: View) => {
    setView(next);
    setMobileOpen(false);
  };

  if (booting)
    return (
      <div className="style-nova grid min-h-svh place-items-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Загружаем рабочее
          пространство…
        </div>
      </div>
    );
  if (!user)
    return (
      <div className="style-nova">
        <LoginScreen error={authError} onLogin={login} />
      </div>
    );

  return (
    <div className="style-nova app-shell flex bg-background">
      <DesktopSidebar
        user={user}
        view={view}
        onNavigate={go}
        onLogout={logout}
      />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="app-sidebar w-[min(86vw,320px)] border-0 p-0"
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-white/10 p-5 text-left">
            <SheetTitle className="text-white">BURЖУЙ Команда</SheetTitle>
            <SheetDescription className="text-white/55">
              Рабочее пространство сети
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <SidebarNav user={user} view={view} onNavigate={go} />
            <Button
              variant="ghost"
              className="mt-5 w-full justify-start gap-3 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={logout}
            >
              <LogOut className="size-4" /> Выйти
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <div className="app-content flex min-h-svh min-w-0 flex-1 flex-col">
        <Header
          user={user}
          onOpenMenu={() => setMobileOpen(true)}
          onRefresh={() => setRefreshKey((key) => key + 1)}
          onLogout={logout}
        />
        <main
          className="mobile-main mx-auto w-full max-w-[1540px] flex-1 px-4 py-5 sm:px-6 lg:px-10 lg:py-8"
          tabIndex={-1}
        >
          {notice && (
            <Alert className="mb-5 border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 className="size-4" />
              <AlertTitle>Готово</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {view === "overview" && (
            <OverviewView user={user} refreshKey={refreshKey} onNavigate={go} />
          )}
          {view === "tasks" && (
            <TasksView
              user={user}
              refreshKey={refreshKey}
              onNotice={setNotice}
            />
          )}
          {view === "team" && (
            <TeamView
              user={user}
              refreshKey={refreshKey}
              onNotice={setNotice}
            />
          )}
          {view === "analytics" && (
            <AnalyticsView user={user} refreshKey={refreshKey} />
          )}
          {view === "profile" && (
            <ProfileView user={user} onPasswordChanged={setNotice} />
          )}
        </main>
        <MobileBottomNav user={user} view={view} onNavigate={go} />
      </div>
    </div>
  );
}

function LoginScreen({
  error,
  onLogin,
}: {
  error: string;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await onLogin(username, password);
    setBusy(false);
  };
  return (
    <main className="grid min-h-svh bg-[#211c1d] lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-40 -top-40 size-[34rem] rounded-full bg-[#7b1e2b]/40 blur-3xl" />
        <div className="relative">
          <div className="mb-10 flex items-center gap-3">
            <BrandMark />
            <span className="text-sm font-semibold tracking-[.18em]">
              BURЖУЙ
            </span>
          </div>
          <Badge variant="outline" className="border-white/20 text-white/75">
            Командный центр
          </Badge>
          <h1 className="display-title mt-8 max-w-xl text-6xl font-semibold xl:text-7xl">
            Делаем сервис сильнее — каждый день.
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-white/60">
            Единое пространство для задач, командной ответственности и
            операционных показателей сети.
          </p>
        </div>
        <div className="relative grid max-w-xl gap-3 sm:grid-cols-3">
          <Feature icon={Target} title="Фокус" text="Задачи по людям" />
          <Feature icon={TrendingUp} title="Ритм" text="Показатели в моменте" />
          <Feature
            icon={ShieldCheck}
            title="Контроль"
            text="Фото и комментарии"
          />
        </div>
      </section>
      <section className="flex min-h-svh items-center bg-[#fbfaf9] px-5 py-8 sm:px-10">
        <div className="mx-auto w-full max-w-[440px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <BrandMark dark />
            <span className="text-sm font-bold tracking-[.18em]">
              BURЖУЙ КОМАНДА
            </span>
          </div>
          <div className="mb-8">
            <div className="eyebrow mb-3">Рабочее пространство</div>
            <h2 className="display-title text-4xl font-semibold">
              С возвращением
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Войдите, чтобы увидеть свои задачи и показатели.
            </p>
          </div>
          {error && (
            <Alert variant="destructive" className="mb-5">
              <X className="size-4" />
              <AlertTitle>Не удалось войти</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form className="space-y-5" onSubmit={submit}>
            <Field label="Логин">
              <Input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Введите логин"
                required
                className="h-12 bg-white"
              />
            </Field>
            <Field label="Пароль">
              <div className="relative">
                <Input
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Введите пароль"
                  required
                  className="h-12 bg-white pr-12"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label={
                    showPassword ? "Скрыть пароль" : "Показать пароль"
                  }
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? (
                    <X className="size-4" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                </Button>
              </div>
            </Field>
            <Button
              type="submit"
              size="lg"
              className="h-12 w-full"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ChevronRight className="size-4" />
              )}{" "}
              Войти в систему
            </Button>
          </form>
          <p className="mt-8 text-center text-xs leading-5 text-muted-foreground">
            Доступ выдан администратором. Если не получается войти — обратитесь
            к руководителю.
          </p>
        </div>
      </section>
    </main>
  );
}

function BrandMark({ dark = false }: { dark?: boolean }) {
  return (
    <div
      className={cn(
        "grid size-10 place-items-center rounded-xl text-sm font-black shadow-lg",
        dark ? "bg-primary text-white" : "bg-white text-primary",
      )}
    >
      Б
    </div>
  );
}
function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Target;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <Icon className="mb-4 size-5 text-[#d49a9e]" />
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs text-white/45">{text}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DesktopSidebar({
  user,
  view,
  onNavigate,
  onLogout,
}: {
  user: User;
  view: View;
  onNavigate: (view: View) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="app-sidebar hidden w-[260px] shrink-0 flex-col px-4 py-5 lg:flex">
      <div className="flex items-center gap-3 px-3">
        <BrandMark />
        <div>
          <div className="text-sm font-black tracking-[.17em]">BURЖУЙ</div>
          <div className="text-[10px] uppercase tracking-[.18em] text-white/40">
            Команда
          </div>
        </div>
      </div>
      <div className="mt-10 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-white/30">
        Рабочее меню
      </div>
      <div className="mt-3 flex-1">
        <SidebarNav user={user} view={view} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-white/10 pt-4">
        <div className="mb-4 flex items-center gap-3 px-3">
          <Avatar size="sm" className="bg-[#8e3543] text-white">
            <AvatarFallback className="bg-[#8e3543] text-white">
              {initials(user.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {user.full_name}
            </div>
            <div className="truncate text-xs text-white/45">
              {roleName(user.role)}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-white/55 hover:bg-white/10 hover:text-white"
          onClick={onLogout}
        >
          <LogOut className="size-4" /> Выйти
        </Button>
      </div>
    </aside>
  );
}
function SidebarNav({
  user,
  view,
  onNavigate,
}: {
  user: User;
  view: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <nav aria-label="Основная навигация" className="grid gap-1">
      {navItems
        .filter((item) => item.roles.includes(user.role))
        .map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="nav-item flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold focus-ring"
            data-active={view === id}
            aria-current={view === id ? "page" : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon className="size-[18px]" />
            <span>{label}</span>
            {id === "tasks" && (
              <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">
                LIVE
              </span>
            )}
          </button>
        ))}
    </nav>
  );
}
function MobileBottomNav({
  user,
  view,
  onNavigate,
}: {
  user: User;
  view: View;
  onNavigate: (view: View) => void;
}) {
  const mobileViews: Record<Role, View[]> = {
    developer: ["overview", "tasks", "analytics", "profile"],
    supervisor: ["overview", "tasks", "analytics", "profile"],
    manager: ["overview", "tasks", "team", "profile"],
    employee: ["overview", "tasks", "profile"],
  };
  const items = mobileViews[user.role]
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));
  return (
    <nav
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 grid border-t bg-white/95 px-1 pt-2 shadow-[0_-8px_24px_rgba(50,25,20,.08)] backdrop-blur lg:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      aria-label="Мобильная навигация"
    >
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={cn(
            "flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-bold text-muted-foreground focus-ring",
            view === id && "text-primary",
          )}
          onClick={() => onNavigate(id)}
          aria-current={view === id ? "page" : undefined}
        >
          <Icon className="size-5" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
function Header({
  user,
  onOpenMenu,
  onRefresh,
  onLogout,
}: {
  user: User;
  onOpenMenu: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b bg-[#f8f6f3]/90 px-4 py-3 backdrop-blur sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="touch-target lg:hidden"
            aria-label="Открыть меню"
            onClick={onOpenMenu}
          >
            <Menu className="size-5" />
          </Button>
          <div>
            <div className="eyebrow hidden sm:block">BURЖУЙ Команда</div>
            <div className="text-sm font-bold sm:hidden">BURЖУЙ Команда</div>
            <div className="hidden text-xs text-muted-foreground sm:block">
              Добрый день, {user.full_name.split(" ")[0]}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="touch-target"
            aria-label="Обновить данные"
            onClick={onRefresh}
          >
            <RefreshCw className="size-4" />
          </Button>
          <div className="hidden items-center gap-3 border-l pl-4 sm:flex">
            <Avatar size="sm">
              <AvatarFallback>{initials(user.full_name)}</AvatarFallback>
            </Avatar>
            <div className="hidden xl:block">
              <div className="text-sm font-semibold">{user.full_name}</div>
              <div className="text-xs text-muted-foreground">
                {roleName(user.role)}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="touch-target sm:hidden"
            aria-label="Выйти"
            onClick={onLogout}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
function roleName(role: Role) {
  return role === "developer"
    ? "Разработчик"
    : role === "supervisor"
      ? "Управляющий"
    : role === "manager"
      ? "Менеджер"
      : "Сотрудник";
}
function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="eyebrow mb-2">{eyebrow}</div>
        <h1 className="display-title text-3xl font-semibold sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function OverviewView({
  user,
  refreshKey,
  onNavigate,
}: {
  user: User;
  refreshKey: number;
  onNavigate: (view: View) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [sales, setSales] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    const statsRequest =
      user.role === "employee"
        ? Promise.resolve({ stats: {} as Record<string, number> })
        : api<{ stats: Record<string, number> }>("/api/task-stats");
    const metricsRequest =
      user.role === "employee"
        ? api<Record<string, unknown>>(
            `/api/my-metrics?from=${daysAgo(6)}&to=${today()}`,
          ).then(normalizeMyMetrics)
        : api<Record<string, unknown>>(
            `/api/sales?departmentId=${encodeURIComponent(departmentParamForUser(user))}&from=${daysAgo(6)}&to=${today()}`,
          ).then(normalizeSales);
    Promise.all([
      api<{ tasks: Task[] }>("/api/tasks"),
      statsRequest,
      metricsRequest,
    ])
      .then(([taskResult, statsResult, salesResult]) => {
        if (!active) return;
        setTasks(taskResult.tasks || []);
        setStats(statsResult.stats || {});
        setSales(salesResult);
      })
      .catch((e) => active && setError(errorText(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refreshKey, user.role]);
  const kpi = sales?.kpi || {};
  const openTasks =
    stats?.open ?? tasks.filter((task) => task.status !== "done").length;
  const doneTasks =
    stats?.done ?? tasks.filter((task) => task.status === "done").length;
  const chart = (sales?.daily || []).map((row) => ({
    name: row.date ? formatDate(row.date) : "—",
    value: row.revenue || 0,
  }));
  return (
    <>
      <PageIntro
        eyebrow="Сегодня в работе"
        title={`Обзор, ${user.full_name.split(" ")[0]}`}
        description={
          user.role === "employee"
            ? "Ваши задачи, личный прогресс и ближайшие действия."
            : "Короткий срез операционного ритма команды и продаж."
        }
        action={
          <Button className="gap-2" onClick={() => onNavigate("tasks")}>
            <Plus className="size-4" />{" "}
            {user.role === "employee" ? "Мои задачи" : "Новая задача"}
          </Button>
        }
      />
      {error && (
        <Alert variant="destructive" className="mb-5">
          <X className="size-4" />
          <AlertTitle>Не удалось загрузить часть данных</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading ? (
        <OverviewSkeleton />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={ClipboardCheck}
              label="Открытые задачи"
              value={formatNumber(openTasks)}
              detail={`${formatNumber(doneTasks)} закрыто`}
              tone="primary"
            />
            <KpiCard
              icon={CircleDollarSign}
              label="Выручка за 7 дней"
              value={formatMoney(kpi.totalRevenue)}
              detail={`${formatNumber(kpi.totalOrders)} чеков`}
            />
            <KpiCard
              icon={TrendingUp}
              label="Средний чек"
              value={formatMoney(kpi.avgCheck)}
              detail={`${formatNumber(kpi.totalDishes)} блюд`}
            />
            <KpiCard
              icon={Sparkles}
              label={user.role === "employee" ? "Напитки к блюдам" : "Апсейл"}
              value={`${user.role === "employee" ? sales?.upsell?.drinkRatioQty || 0 : sales?.upsell?.upsellShare || 0}%`}
              detail={user.role === "employee" ? `Допы: ${sales?.upsell?.addonRatioQty || 0}%` : "доля в кассе"}
              tone="soft"
            />
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_.8fr]">
            <Card className="surface min-w-0">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Динамика выручки</CardTitle>
                  <CardDescription>Последние семь дней</CardDescription>
                </div>
                <Badge variant="outline" className="gap-1">
                  <ArrowUpRight className="size-3 text-emerald-600" />{" "}
                  Оперативно
                </Badge>
              </CardHeader>
              <CardContent>
                {chart.length ? (
                  <div className="h-[240px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chart}
                        margin={{ top: 10, right: 8, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="overview-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#7b1e2b"
                              stopOpacity={0.28}
                            />
                            <stop
                              offset="100%"
                              stopColor="#7b1e2b"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          className="chart-grid"
                        />
                        <XAxis
                          dataKey="name"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "#8b7b74" }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "#8b7b74" }}
                          tickFormatter={(value) =>
                            `${Math.round(value / 1000)}k`
                          }
                        />
                        <Tooltip
                          formatter={(value) => formatMoney(Number(value))}
                          contentStyle={{
                            borderRadius: 12,
                            borderColor: "#e8dfda",
                            boxShadow: "0 10px 28px rgba(60,30,20,.12)",
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="#7b1e2b"
                          strokeWidth={3}
                          fill="url(#overview-fill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                    <p className="sr-only">
                      График выручки по дням:{" "}
                      {chart
                        .map(
                          (point) =>
                            `${point.name} — ${formatMoney(point.value)}`,
                        )
                        .join(", ")}
                    </p>
                  </div>
                ) : (
                  <EmptyState
                    icon={BarChart3}
                    title="Нет данных за период"
                    text="Попробуйте обновить данные позже."
                  />
                )}
              </CardContent>
            </Card>
            <Card className="surface">
              <CardHeader>
                <CardTitle>Фокус команды</CardTitle>
                <CardDescription>Статусы задач на сейчас</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {(["new", "in_progress", "review", "done"] as TaskStatus[]).map(
                  (status) => {
                    const count = tasks.filter(
                      (task) => task.status === status,
                    ).length;
                    const ratio = tasks.length
                      ? Math.round((count / tasks.length) * 100)
                      : 0;
                    return (
                      <div key={status}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-semibold">
                            {statusLabels[status]}
                          </span>
                          <span className="text-muted-foreground">{count}</span>
                        </div>
                        <Progress value={ratio} className="gap-0" />
                      </div>
                    );
                  },
                )}
              </CardContent>
              <CardFooter className="border-t pt-4">
                <Button
                  variant="ghost"
                  className="w-full justify-between"
                  onClick={() => onNavigate("tasks")}
                >
                  Открыть все задачи <ChevronRight className="size-4" />
                </Button>
              </CardFooter>
            </Card>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
            <RecentTasks
              tasks={tasks.slice(0, 5)}
              onOpen={() => onNavigate("tasks")}
            />
            <Card className="surface">
              <CardHeader>
                <CardTitle>Апсейл</CardTitle>
                <CardDescription>Напитки и дополнения к блюдам</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <MiniMetric
                  label="Напитки"
                  value={`${sales?.upsell?.drinkRatioQty || 0}%`}
                />
                <MiniMetric
                  label="Допы"
                  value={`${sales?.upsell?.addonRatioQty || 0}%`}
                />
                <div className="col-span-2 rounded-xl bg-[#f7efed] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="size-4 text-primary" /> Сумма апсейла
                  </div>
                  <div className="mt-2 text-2xl font-bold tracking-tight">
                    {formatMoney(sales?.upsell?.totalUpsellRev)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_.8fr]">
        <Skeleton className="h-[340px] rounded-2xl" />
        <Skeleton className="h-[340px] rounded-2xl" />
      </div>
    </div>
  );
}
function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: typeof ClipboardCheck;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "primary" | "soft";
}) {
  return (
    <Card
      className={cn(
        "surface",
        tone === "primary" && "bg-[#211c1d] text-white",
        tone === "soft" && "bg-[#f7efed]",
      )}
    >
      <CardContent className="p-5">
        <div className="mb-5 flex items-center justify-between">
          <div
            className={cn(
              "grid size-10 place-items-center rounded-xl",
              tone === "primary"
                ? "bg-white/10 text-[#f0cacc]"
                : "bg-[#f7efed] text-primary",
            )}
          >
            <Icon className="size-5" />
          </div>
          <ArrowUpRight
            className={cn(
              "size-4",
              tone === "primary" ? "text-[#d49a9e]" : "text-emerald-600",
            )}
          />
        </div>
        <div
          className={cn(
            "text-xs",
            tone === "primary" ? "text-white/55" : "text-muted-foreground",
          )}
        >
          {label}
        </div>
        <div className="kpi-value mt-2 text-2xl font-bold sm:text-3xl">
          {value}
        </div>
        <div
          className={cn(
            "mt-2 text-xs",
            tone === "primary" ? "text-white/45" : "text-muted-foreground",
          )}
        >
          {detail}
        </div>
      </CardContent>
    </Card>
  );
}
function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-bold tracking-tight">{value}</div>
    </div>
  );
}
function RecentTasks({ tasks, onOpen }: { tasks: Task[]; onOpen: () => void }) {
  return (
    <Card className="surface">
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>Последние задачи</CardTitle>
          <CardDescription>Что сейчас требует внимания</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Все задачи"
          onClick={onOpen}
        >
          <ChevronRight className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.length ? (
          tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={onOpen}
              className="focus-ring flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-muted"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  task.status === "done"
                    ? "bg-emerald-500"
                    : task.priority === "urgent"
                      ? "bg-red-500"
                      : "bg-primary",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {task.title}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {task.assignee_name || "Без исполнителя"} ·{" "}
                  {formatDate(task.due_at)}
                </span>
              </span>
              <Badge variant={task.status === "done" ? "secondary" : "outline"}>
                {statusLabels[task.status]}
              </Badge>
            </button>
          ))
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="Задач пока нет"
            text="Добавьте первую задачу для команды."
          />
        )}
      </CardContent>
    </Card>
  );
}
function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof ClipboardCheck;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-32 place-items-center py-6 text-center">
      <Icon className="mb-3 size-7 text-primary/55" />
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
        {text}
      </div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function TasksView({
  user,
  refreshKey,
  onNotice,
}: {
  user: User;
  refreshKey: number;
  onNotice: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ tasks: Task[] }>("/api/tasks"),
      user.role !== "employee"
        ? api<{ users: User[] }>("/api/users")
        : Promise.resolve({ users: [] }),
      user.role !== "employee"
        ? api<{ departments: Department[] }>("/api/departments")
        : Promise.resolve({ departments: [] }),
    ])
      .then(([tasksResult, usersResult, departmentsResult]) => {
        setTasks(tasksResult.tasks || []);
        setUsers(usersResult.users || []);
        setDepartments(
          departmentsForUser(user, departmentsResult.departments || []),
        );
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]);
  const filtered = tasks.filter(
    (task) =>
      (!search ||
        `${task.title} ${task.description || ""} ${task.assignee_name || ""}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (status === "all" || task.status === status) &&
      (priority === "all" || task.priority === priority),
  );
  const open = (task?: Task) => {
    setSelectedTask(task || null);
    setDialogOpen(true);
  };
  return (
    <>
      <PageIntro
        eyebrow="Рабочий поток"
        title="Задачи"
        description={
          user.role === "employee"
            ? "Ваш список задач и обратная связь по выполнению."
            : "Распределяйте договорённости после планёрки и контролируйте результат."
        }
        action={
          user.role !== "employee" && (
            <Button className="gap-2" onClick={() => open()}>
              <Plus className="size-4" /> Создать задачу
            </Button>
          )
        }
      />
      {error && (
        <Alert variant="destructive" className="mb-5">
          <X className="size-4" />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="surface mb-5">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_170px_170px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 bg-white pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по задачам…"
              aria-label="Поиск по задачам"
            />
          </div>
          <NativeSelect className="w-full">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Фильтр статуса"
            >
              <NativeSelectOption value="all">Все статусы</NativeSelectOption>
              {Object.entries(statusLabels).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </select>
          </NativeSelect>
          <NativeSelect className="w-full">
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              aria-label="Фильтр приоритета"
            >
              <NativeSelectOption value="all">
                Все приоритеты
              </NativeSelectOption>
              {Object.entries(priorityLabels).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </select>
          </NativeSelect>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              setSearch("");
              setStatus("all");
              setPriority("all");
            }}
          >
            <Filter className="size-4" /> Сбросить
          </Button>
        </CardContent>
      </Card>
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <Skeleton className="h-52 rounded-2xl" key={item} />
          ))}
        </div>
      ) : filtered.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={() => open(task)}
              onStatusChange={async (next) => {
                try {
                  await api(`/api/tasks/${task.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: next }),
                  });
                  onNotice("Статус задачи обновлён");
                  load();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
              canEdit={user.role !== "employee"}
            />
          ))}
        </div>
      ) : (
        <Card className="surface">
          <CardContent>
            <EmptyState
              icon={ClipboardCheck}
              title="Подходящих задач нет"
              text="Измените фильтры или создайте новую задачу."
              action={
                user.role !== "employee" ? (
                  <Button onClick={() => open()}>
                    <Plus className="size-4" /> Создать задачу
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      )}
      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={selectedTask}
        user={user}
        users={users}
        departments={departments}
        onSaved={() => {
          setDialogOpen(false);
          onNotice("Задача сохранена");
          load();
        }}
      />{" "}
    </>
  );
}

function TaskCard({
  task,
  onOpen,
  onStatusChange,
  canEdit,
}: {
  task: Task;
  onOpen: () => void;
  onStatusChange: (status: TaskStatus) => Promise<void>;
  canEdit: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const next =
    task.status === "new"
      ? "in_progress"
      : task.status === "in_progress"
        ? "review"
        : ("done" as TaskStatus);
  const canAdvance =
    task.status !== "done" && (canEdit || task.status !== "review");
  const advance = async () => {
    setBusy(true);
    await onStatusChange(next);
    setBusy(false);
  };
  return (
    <Card className="surface group transition hover:-translate-y-0.5 hover:shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <Badge
            variant={
              task.priority === "urgent"
                ? "destructive"
                : task.priority === "high"
                  ? "default"
                  : "outline"
            }
          >
            {priorityLabels[task.priority]}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Открыть задачу"
            onClick={onOpen}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
        <CardTitle className="line-clamp-2 pt-1 text-base">
          {task.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
          {task.description || "Без описания"}
        </p>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <Avatar size="sm">
              <AvatarFallback>{initials(task.assignee_name)}</AvatarFallback>
            </Avatar>
            <span className="truncate">
              {task.assignee_name || "Без исполнителя"}
            </span>
          </span>
          <span className="shrink-0">{formatDate(task.due_at)}</span>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t pt-4">
        <Badge variant={task.status === "done" ? "secondary" : "outline"}>
          {statusLabels[task.status]}
        </Badge>
        {canAdvance && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-primary"
            disabled={busy}
            onClick={advance}
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3" />
            )}{" "}
            {task.status === "in_progress" ? "На проверку" : "Продвинуть"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function TaskDialog({
  open,
  onOpenChange,
  task,
  user,
  users,
  departments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  user: User;
  users: User[];
  departments: Department[];
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"detail" | "edit">(task ? "detail" : "edit");
  const [detail, setDetail] = useState<Task | null>(task);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setMode(task ? "detail" : "edit");
    setDetail(task);
    setComment("");
    setFile(null);
    setPreview("");
    setError("");
    if (open && task)
      api<{ task: Task }>(`/api/tasks/${task.id}`)
        .then((result) => setDetail(result.task))
        .catch(() => undefined);
  }, [open, task]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get("title") || ""),
      description: String(form.get("description") || ""),
      status: String(form.get("status") || "new"),
      priority: String(form.get("priority") || "normal"),
      due_at: String(form.get("due_at") || "") || null,
      assignee_id: String(form.get("assignee_id") || "") || null,
      department_id: String(form.get("department_id") || "") || null,
      department_name:
        departments.find((item) => item.id === form.get("department_id"))
          ?.name || null,
    };
    try {
      if (task)
        await api(`/api/tasks/${task.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      else
        await api("/api/tasks", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const addComment = async () => {
    if (!detail || !comment.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ comment: Comment }>(
        `/api/tasks/${detail.id}/comments`,
        jsonBody({ body: comment.trim() }),
      );
      setDetail({
        ...detail,
        comments: [...(detail.comments || []), result.comment],
      });
      setComment("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const selectPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  };
  const uploadPhoto = async () => {
    if (!detail || !file) return;
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append("photo", compressed, compressed.name);
      const result = await api<{ attachment: Attachment }>(
        `/api/tasks/${detail.id}/attachments`,
        { method: "POST", body: form },
      );
      setDetail({
        ...detail,
        attachments: [...(detail.attachments || []), result.attachment],
      });
      setFile(null);
      setPreview("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(92svh,820px)] max-w-2xl overflow-y-auto rounded-2xl p-0"
        aria-describedby="task-dialog-description"
      >
        <DialogHeader className="border-b px-5 py-5 pr-14 text-left sm:px-7">
          <DialogTitle>{task ? task.title : "Новая задача"}</DialogTitle>
          <DialogDescription id="task-dialog-description">
            {task
              ? "Детали, комментарии и подтверждение выполнения."
              : "Назначьте понятный следующий шаг ответственному сотруднику."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" className="mx-5 mt-5 sm:mx-7">
            <X className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {mode === "edit" ? (
          <TaskForm
            task={task}
            user={user}
            users={users}
            departments={departments}
            busy={busy}
            onCancel={() => (task ? setMode("detail") : onOpenChange(false))}
            onSubmit={save}
          />
        ) : (
          detail && (
            <div className="space-y-5 p-5 sm:p-7">
              <div className="grid gap-3 sm:grid-cols-3">
                <InfoTile label="Статус">
                  <Badge
                    variant={detail.status === "done" ? "secondary" : "outline"}
                  >
                    {statusLabels[detail.status]}
                  </Badge>
                </InfoTile>
                <InfoTile label="Приоритет">
                  <Badge
                    variant={
                      detail.priority === "urgent" ? "destructive" : "outline"
                    }
                  >
                    {priorityLabels[detail.priority]}
                  </Badge>
                </InfoTile>
                <InfoTile label="Срок">
                  <span className="text-sm font-semibold">
                    {formatDate(detail.due_at, true)}
                  </span>
                </InfoTile>
              </div>
              <div className="rounded-xl bg-muted/60 p-4 text-sm leading-6 text-foreground/80">
                {detail.description || "Описание не добавлено."}
              </div>
              <div className="flex flex-wrap gap-2">
                {user.role !== "employee" && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => setMode("edit")}
                  >
                    <Pencil className="size-4" /> Изменить
                  </Button>
                )}
                {detail.status !== "done" &&
                  (user.role !== "employee" || detail.status !== "review") && (
                    <Button
                      className="gap-2"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const next: TaskStatus =
                            detail.status === "new"
                              ? "in_progress"
                              : detail.status === "in_progress"
                                ? "review"
                                : "done";
                          const result = await api<{ task: Task }>(
                            `/api/tasks/${detail.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({ status: next }),
                            },
                          );
                          setDetail(result.task);
                        } catch (e) {
                          setError(errorText(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}{" "}
                      {detail.status === "review"
                        ? "Подтвердить выполнение"
                        : detail.status === "in_progress"
                          ? "Отправить на проверку"
                          : "Начать работу"}
                    </Button>
                  )}
              </div>
              <section>
                <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                  <MessageCircle className="size-4 text-primary" /> Комментарии
                </div>
                <div className="space-y-3">
                  {detail.comments?.length ? (
                    detail.comments.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border bg-white p-3"
                      >
                        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {item.user_name || item.author_name || "Сотрудник"}
                          </span>
                          <span>{formatDate(item.created_at, true)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-5">
                          {item.body}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Комментариев пока нет.
                    </p>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Добавить комментарий…"
                    rows={2}
                    className="bg-white"
                  />
                  <Button
                    className="shrink-0 self-end"
                    size="icon"
                    aria-label="Отправить комментарий"
                    disabled={!comment.trim() || busy}
                    onClick={addComment}
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
              </section>
              <section>
                <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                  <FileImage className="size-4 text-primary" /> Фотоотчёт
                </div>
                {preview ? (
                  <div className="mb-3 overflow-hidden rounded-xl border bg-muted">
                    <img
                      src={preview}
                      alt="Предпросмотр фотоотчёта"
                      className="max-h-64 w-full object-contain"
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 text-sm font-semibold hover:bg-muted">
                    <Camera className="size-4" /> Камера или галерея
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={selectPhoto}
                    />
                  </label>
                  {file && (
                    <>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={uploadPhoto}
                        disabled={busy}
                      >
                        <Upload className="size-4" /> Загрузить
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setFile(null);
                          setPreview("");
                        }}
                      >
                        <X className="size-4" /> Убрать
                      </Button>
                    </>
                  )}
                </div>
                {detail.attachments?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.attachments.map((attachment) => (
                      <a
                        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted"
                        href={`/api/attachments/${attachment.id}`}
                        target="_blank"
                        rel="noreferrer"
                        key={attachment.id}
                      >
                        <ImagePlus className="size-3.5 text-primary" /> Открыть
                        фото
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Добавьте фото, чтобы подтвердить результат.
                  </p>
                )}
              </section>
            </div>
          )
        )}
        <DialogFooter className="border-t px-5 py-4 sm:px-7">
          {mode === "detail" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  task,
  user,
  users,
  departments,
  busy,
  onCancel,
  onSubmit,
}: {
  task: Task | null;
  user: User;
  users: User[];
  departments: Department[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [selectedTaskDepartmentId, setSelectedTaskDepartmentId] = useState(
    task?.department_id ||
      (departmentsForUser(user, departments).length === 1
        ? departmentsForUser(user, departments)[0].id
        : ""),
  );
  const availableUsers =
    users.filter(
      (item) =>
        item.role === "employee" &&
        (user.role !== "manager" ||
          item.all_departments ||
          userDepartmentIds(item).some((id) => hasDepartment(user, id))),
    );
  const availableDepartments = departmentsForUser(user, departments);
  const departmentUsers = availableUsers.filter(
    (item) => !selectedTaskDepartmentId || hasDepartment(item, selectedTaskDepartmentId),
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-5 p-5 sm:p-7">
      <Field label="Название">
        <Input
          name="title"
          defaultValue={task?.title || ""}
          placeholder="Например, проверить витрину"
          required
          className="h-11 bg-white"
        />
      </Field>
      <Field label="Описание">
        <Textarea
          name="description"
          defaultValue={task?.description || ""}
          placeholder="Что нужно сделать и какой результат ожидаем"
          rows={4}
          className="bg-white"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Статус">
          <NativeSelect className="w-full">
            <select name="status" defaultValue={task?.status || "new"}>
              <NativeSelectOption value="new">Новая</NativeSelectOption>
              <NativeSelectOption value="in_progress">
                В работе
              </NativeSelectOption>
              <NativeSelectOption value="review">
                На проверке
              </NativeSelectOption>
              <NativeSelectOption value="done">Готово</NativeSelectOption>
            </select>
          </NativeSelect>
        </Field>
        <Field label="Приоритет">
          <NativeSelect className="w-full">
            <select name="priority" defaultValue={task?.priority || "normal"}>
              {Object.entries(priorityLabels).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </select>
          </NativeSelect>
        </Field>
        <Field label="Ответственный">
          <NativeSelect className="w-full">
            <select key={selectedTaskDepartmentId} name="assignee_id" defaultValue={departmentUsers.some((item) => item.id === task?.assignee_id) ? task?.assignee_id || "" : ""}>
              <NativeSelectOption value="">Без исполнителя</NativeSelectOption>
              {departmentUsers.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.full_name}
                </NativeSelectOption>
              ))}
            </select>
          </NativeSelect>
        </Field>
        <Field label="Срок">
          <Input
            name="due_at"
            type="datetime-local"
            defaultValue={
              task?.due_at
                ? new Date(task.due_at).toISOString().slice(0, 16)
                : ""
            }
            className="h-11 bg-white"
          />
        </Field>
        {user.role !== "employee" && (
          <Field label="Точка">
            <NativeSelect className="w-full">
              <select
                name="department_id"
                value={selectedTaskDepartmentId}
                onChange={(event) => setSelectedTaskDepartmentId(event.target.value)}
                required
              >
                <NativeSelectOption value="">Выберите точку</NativeSelectOption>
                {availableDepartments.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name}
                  </NativeSelectOption>
                ))}
              </select>
            </NativeSelect>
          </Field>
        )}
      </div>
      <DialogFooter className="mt-1 p-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}{" "}
          Сохранить задачу
        </Button>
      </DialogFooter>
    </form>
  );
}
function InfoTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="mb-2 text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
  });
}

function TeamView({
  user,
  refreshKey,
  onNotice,
}: {
  user: User;
  refreshKey: number;
  onNotice: (message: string) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ users: User[] }>("/api/users"),
      api<{ departments: Department[] }>("/api/departments"),
    ])
      .then(([usersResult, departmentsResult]) => {
        setUsers(usersResult.users || []);
        setDepartments(
          departmentsForUser(user, departmentsResult.departments || []),
        );
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]);
  return (
    <>
      <PageIntro
        eyebrow="Люди и роли"
        title="Команда"
        description="Доступы команды и привязка к точкам iiko в одном месте."
        action={
          <Button
            className="gap-2"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Добавить сотрудника
          </Button>
        }
      />
      {error && (
        <Alert variant="destructive" className="mb-5">
          <X className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="surface overflow-hidden">
        {loading ? (
          <div className="grid gap-3 p-5">
            {[1, 2, 3].map((item) => (
              <Skeleton className="h-16 rounded-xl" key={item} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Точка</TableHead>
                  <TableHead>iiko-код</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex min-w-[190px] items-center gap-3">
                        <Avatar size="sm">
                          <AvatarFallback>
                            {initials(member.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-semibold">
                            {member.full_name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            @{member.username}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          member.role === "developer" ? "default" : "outline"
                        }
                      >
                        {roleName(member.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {member.all_departments
                        ? "Все точки"
                        : member.department_ids?.length
                          ? `${member.department_ids.length} точек`
                          : member.department_name || "Точки не назначены"}
                    </TableCell>
                    <TableCell>{member.iiko_employee_code || "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={member.active ? "secondary" : "destructive"}
                      >
                        {member.active ? "Активен" : "Отключён"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(user.role === "developer" ||
                        member.role === "employee") && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Изменить ${member.full_name}`}
                          onClick={() => {
                            setEditing(member);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!loading && !users.length && (
          <div className="p-5">
            <EmptyState
              icon={Users}
              title="Сотрудников пока нет"
              text="Добавьте первого участника команды."
            />
          </div>
        )}
      </Card>
      <UserDialog
        open={open}
        onOpenChange={setOpen}
        user={editing}
        currentUser={user}
        departments={departments}
        onSaved={() => {
          setOpen(false);
          onNotice("Профиль сотрудника сохранён");
          load();
        }}
      />
    </>
  );
}

function UserDialog({
  open,
  onOpenChange,
  user,
  currentUser,
  departments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  currentUser: User;
  departments: Department[];
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>(user?.role || "employee");
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>(
    userDepartmentIds(user || currentUser),
  );
  const [allDepartments, setAllDepartments] = useState(
    Boolean(user?.all_departments),
  );

  useEffect(() => {
    if (!open) return;
    setRole(user?.role || "employee");
    setSelectedDepartmentIds(userDepartmentIds(user || currentUser));
    setAllDepartments(Boolean(user?.all_departments));
    setError("");
  }, [open, user, currentUser]);

  const availableDepartments = departmentsForUser(currentUser, departments);
  const roleOptions: { value: Role; label: string; disabled?: boolean }[] =
    currentUser.role === "developer"
      ? [
          ...(user?.role === "developer"
            ? [{ value: "developer" as Role, label: "Разработчик", disabled: true }]
            : []),
          { value: "supervisor", label: "Управляющий" },
          { value: "manager", label: "Менеджер" },
          { value: "employee", label: "Сотрудник" },
        ]
      : [{ value: "employee", label: "Сотрудник" }];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const effectiveAllDepartments = isNetworkRole(role) || allDepartments;
    const payload = {
      full_name: String(form.get("full_name") || ""),
      username: String(form.get("username") || ""),
      password: String(form.get("password") || "") || undefined,
      role,
      department_ids: effectiveAllDepartments ? [] : selectedDepartmentIds,
      all_departments: effectiveAllDepartments,
      department_id: effectiveAllDepartments ? null : selectedDepartmentIds[0] || null,
      department_name: effectiveAllDepartments
        ? null
        : departments.find((item) => item.id === selectedDepartmentIds[0])
            ?.name || null,
      iiko_employee_name: String(form.get("iiko_employee_name") || "") || null,
      iiko_employee_code: String(form.get("iiko_employee_code") || "") || null,
      active: form.get("active") === "on",
    };
    if (user && currentUser.role !== "developer") {
      delete (payload as Partial<typeof payload>).role;
    }
    try {
      await api(user ? `/api/users/${user.id}` : "/api/users", {
        method: user ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92svh,780px)] max-w-xl overflow-y-auto rounded-2xl p-0">
        <DialogHeader className="border-b px-5 py-5 pr-14 text-left">
          <DialogTitle>
            {user ? "Профиль сотрудника" : "Новый сотрудник"}
          </DialogTitle>
          <DialogDescription>
            Доступ, роль и связь с показателями iiko.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive" className="mx-5 mt-5">
            <X className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form className="grid gap-4 p-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ФИО">
              <Input
                name="full_name"
                defaultValue={user?.full_name || ""}
                required
                className="bg-white"
              />
            </Field>
            <Field label="Логин">
              <Input
                name="username"
                defaultValue={user?.username || ""}
                required
                className="bg-white"
              />
            </Field>
            <Field label={user ? "Новый пароль (необязательно)" : "Пароль"}>
              <Input
                name="password"
                type="password"
                required={!user}
                className="bg-white"
              />
            </Field>
            <Field label="Роль">
              <NativeSelect className="w-full">
                <select
                  name="role"
                  value={role}
                  onChange={(event) => {
                    const nextRole = event.target.value as Role;
                    setRole(nextRole);
                    setAllDepartments(isNetworkRole(nextRole));
                  }}
                  disabled={currentUser.role !== "developer" || user?.role === "developer"}
                >
                  {roleOptions.map((option) => (
                    <NativeSelectOption
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </select>
              </NativeSelect>
            </Field>
            <Field label="Имя в iiko">
              <Input
                name="iiko_employee_name"
                defaultValue={user?.iiko_employee_name || ""}
                className="bg-white"
              />
            </Field>
            <Field label="Код сотрудника iiko">
              <Input
                name="iiko_employee_code"
                defaultValue={user?.iiko_employee_code || ""}
                className="bg-white"
              />
            </Field>
          </div>
          <div className="grid gap-3 rounded-xl border bg-muted/30 p-4">
            <div>
              <div className="text-sm font-semibold">Доступ к точкам</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Выберите одну или несколько точек. UUID вводить не нужно.
              </div>
            </div>
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={isNetworkRole(role) || allDepartments}
                onChange={(event) => setAllDepartments(event.target.checked)}
                disabled={isNetworkRole(role)}
                className="size-4 accent-[#7b1e2b]"
              />
              Все доступные точки
            </label>
            {!isNetworkRole(role) && !allDepartments && (
              <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                {availableDepartments.map((department) => (
                  <label
                    key={department.id}
                    className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDepartmentIds.includes(department.id)}
                      onChange={(event) =>
                        setSelectedDepartmentIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, department.id])]
                            : current.filter((id) => id !== department.id),
                        )
                      }
                      className="size-4 accent-[#7b1e2b]"
                    />
                    <span className="truncate">{department.name}</span>
                  </label>
                ))}
                {!availableDepartments.length && (
                  <p className="text-sm text-muted-foreground">
                    Нет доступных точек для назначения.
                  </p>
                )}
              </div>
            )}
          </div>
          <label className="flex items-center gap-3 rounded-xl border p-3 text-sm font-semibold">
            <input
              name="active"
              type="checkbox"
              defaultChecked={user?.active ?? true}
              className="size-4 accent-[#7b1e2b]"
            />{" "}
            Доступ активен
          </label>
          <DialogFooter className="p-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}{" "}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AnalyticsView({
  user,
  refreshKey,
}: {
  user: User;
  refreshKey: number;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const [sales, setSales] = useState<SalesData | null>(null);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("sales");
  useEffect(() => {
    api<{ departments: Department[] }>("/api/departments")
      .then((result) => {
        const scoped = departmentsForUser(user, result.departments || []);
        setDepartments(scoped);
        setDepartmentId((current) => {
          if (isNetworkRole(user.role)) return "ALL";
          if (current && scoped.some((item) => item.id === current)) {
            return current;
          }
          return scoped[0]?.id || "";
        });
      })
      .catch((e) => setError(errorText(e)));
  }, [refreshKey, user.role, user.department_id, user.department_ids, user.all_departments]);
  const apply = () => {
    if (!from || !to || from > to) {
      setError("Проверьте период: дата начала не может быть позже даты окончания.");
      return;
    }
    const selectedDepartment = isNetworkRole(user.role)
      ? "ALL"
      : departmentId;
    if (!selectedDepartment) {
      setError("Выберите доступную точку для аналитики.");
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      departmentId: selectedDepartment,
      from,
      to,
    });
    Promise.all([
      api<Record<string, unknown>>(`/api/sales?${params}`).then(normalizeSales),
      api<{ ranking?: unknown[] }>(
        `/api/ranking?departmentId=${encodeURIComponent(selectedDepartment)}&from=${from}&to=${to}`,
      ),
      api<{ shifts?: Shift[] }>(`/api/shifts?${params}`),
    ])
      .then(([salesResult, rankingResult, shiftsResult]) => {
        setSales(salesResult);
        setRanking(normalizeRanking(rankingResult.ranking));
        setShifts(normalizeShifts(shiftsResult.shifts));
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (departmentId || isNetworkRole(user.role)) apply();
  }, [departmentId, refreshKey, user.role]);
  const chart = (sales?.daily || []).map((row) => ({
    name: row.date ? formatDate(row.date) : "—",
    revenue: row.revenue || 0,
  }));
  return (
    <>
      <PageIntro
        eyebrow="Операционные данные"
        title="Аналитика"
        description="Продажи, конверсия апсейла и командная загрузка за выбранный период."
        action={
          <Button variant="outline" className="gap-2" onClick={apply}>
            <RefreshCw className="size-4" /> Обновить
          </Button>
        }
      />
      {error && (
        <Alert variant="destructive" className="mb-5">
          <X className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="surface mb-5">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1.25fr_1fr_1fr_auto] md:items-end">
          <Field label="Точка">
            <NativeSelect className="w-full">
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                {isNetworkRole(user.role) && (
                  <NativeSelectOption value="ALL">Вся сеть</NativeSelectOption>
                )}
                {departments.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name}
                  </NativeSelectOption>
                ))}
              </select>
            </NativeSelect>
          </Field>
          <Field label="С">
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-10 bg-white"
            />
          </Field>
          <Field label="По">
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 bg-white"
            />
          </Field>
          <Button onClick={apply} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Filter className="size-4" />
            )}{" "}
            Применить
          </Button>
        </CardContent>
      </Card>
      {loading && !sales ? (
        <OverviewSkeleton />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={CircleDollarSign}
              label="Выручка"
              value={formatMoney(sales?.kpi?.totalRevenue)}
              detail={`${sales?.kpi?.daysCount || 0} дней`}
              tone="primary"
            />
            <KpiCard
              icon={ClipboardCheck}
              label="Чеки"
              value={formatNumber(sales?.kpi?.totalOrders)}
              detail={`${formatNumber(sales?.kpi?.totalDishes)} блюд`}
            />
            <KpiCard
              icon={TrendingUp}
              label="Средний чек"
              value={formatMoney(sales?.kpi?.avgCheck)}
              detail="за выбранный период"
            />
            <KpiCard
              icon={Sparkles}
              label="Апсейл"
              value={`${sales?.upsell?.upsellShare || 0}%`}
              detail={`${formatMoney(sales?.upsell?.totalUpsellRev)} выручки`}
              tone="soft"
            />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Card className="surface-soft"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Напитки к блюдам</div><div className="mt-2 text-xl font-bold">{sales?.upsell?.drinkRatioQty || 0}%</div><div className="mt-1 text-xs text-muted-foreground">по выручке: {sales?.upsell?.drinkRatioRev || 0}%</div></CardContent></Card>
            <Card className="surface-soft"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Допы к блюдам</div><div className="mt-2 text-xl font-bold">{sales?.upsell?.addonRatioQty || 0}%</div><div className="mt-1 text-xs text-muted-foreground">по выручке: {sales?.upsell?.addonRatioRev || 0}%</div></CardContent></Card>
            <Card className="surface-soft"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Доля апсейла в кассе</div><div className="mt-2 text-xl font-bold">{sales?.upsell?.upsellShare || 0}%</div></CardContent></Card>
          </div>
          <Card className="surface mt-5">
            <CardHeader>
              <CardTitle>Показатели периода</CardTitle>
              <CardDescription>
                Текстовый fallback доступен ниже графика для быстрого чтения с
                телефона.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] w-full">
                {chart.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chart}
                      margin={{ top: 10, right: 8, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} className="chart-grid" />
                      <XAxis
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: "#8b7b74" }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: "#8b7b74" }}
                        tickFormatter={(value) =>
                          `${Math.round(value / 1000)}k`
                        }
                      />
                      <Tooltip
                        formatter={(value) => formatMoney(Number(value))}
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#7b1e2b"
                        fill="#f3dcdd"
                        strokeWidth={3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    icon={BarChart3}
                    title="Нет данных"
                    text="Выберите период и точку с доступными продажами."
                  />
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                {chart.map((point) => (
                  <span key={point.name}>
                    <b className="text-foreground">{point.name}</b>:{" "}
                    {formatMoney(point.revenue)}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(String(value))}
            className="mt-5"
          >
            <TabsList variant="line" className="mb-4">
              <TabsTrigger value="sales">Продажи и команда</TabsTrigger>
              <TabsTrigger value="shifts">Смены</TabsTrigger>
            </TabsList>
            <TabsContent value="sales">
              <div className="grid gap-5 xl:grid-cols-2">
                <AnalyticsTable
                  title="Топ блюд"
                  icon={Sparkles}
                  headers={["Блюдо", "Кол-во", "Выручка"]}
                  rows={(sales?.topDishes || [])
                    .slice(0, 8)
                    .map((row) => [
                      row.dishName || row.name || "—",
                      formatNumber(row.quantity || row.amount),
                      formatMoney(row.revenue),
                    ])}
                />
                <AnalyticsTable
                  title="Кассиры"
                  icon={Users}
                  headers={["Сотрудник", "Чеки", "Напитки", "Допы"]}
                  rows={(sales?.cashiers || [])
                    .slice(0, 8)
                    .map((row) => [
                      row.name || row.cashierName || "—",
                      formatNumber(row.orders),
                      `${row.drinkRate || 0}%`,
                      `${row.addonRate || 0}%`,
                    ])}
                />
              </div>
              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <AnalyticsTable
                  title="Структура оплат"
                  icon={CircleDollarSign}
                  headers={["Способ оплаты", "Выручка"]}
                  rows={(sales?.payments || []).slice(0, 8).map((row) => [
                    row.paymentType || "—",
                    formatMoney(row.revenue || row.amount),
                  ])}
                />
                <AnalyticsTable
                  title="Почасовая нагрузка"
                  icon={Clock3}
                  headers={["Час", "Чеки", "Выручка"]}
                  rows={(sales?.hourly || []).map((row) => [
                    String(row.hour ?? "—").includes(":") ? String(row.hour) : `${String(row.hour ?? "—").padStart(2, "0")}:00`,
                    formatNumber(row.orders),
                    formatMoney(row.revenue),
                  ])}
                />
              </div>
              <Card className="surface mt-5">
                <CardHeader>
                  <CardTitle>Рейтинг точек</CardTitle>
                  <CardDescription>Сравнение выручки за период</CardDescription>
                </CardHeader>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Точка</TableHead>
                        <TableHead>Выручка</TableHead>
                        <TableHead>Чеки</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ranking.slice(0, 12).map((row, index) => (
                        <TableRow
                          key={`${row.departmentName || row.name}-${index}`}
                        >
                          <TableCell>
                            <span className="mr-3 inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
                              {index + 1}
                            </span>
                            {row.departmentName || row.name || "—"}
                          </TableCell>
                          <TableCell className="font-semibold">
                            {formatMoney(row.revenue || row.totalRevenue)}
                          </TableCell>
                          <TableCell>{formatNumber(row.orders)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </TabsContent>
            <TabsContent value="shifts">
              <Card className="surface overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Дата</TableHead>
                        <TableHead>Смена</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Ответственный</TableHead>
                        <TableHead>Заказы</TableHead>
                        <TableHead>Открытие</TableHead>
                        <TableHead>Закрытие</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shifts.map((shift, index) => (
                        <TableRow key={shift.id || index}>
                          <TableCell>{formatDate(shift.openDate)}</TableCell>
                          <TableCell>№{shift.sessionNumber || "—"}</TableCell>
                          <TableCell>{shift.status || "—"}</TableCell>
                          <TableCell>
                            {shift.manager || shift.responsible || "—"}
                          </TableCell>
                          <TableCell>{formatNumber(shift.payOrders)}</TableCell>
                          <TableCell>
                            {formatDate(shift.openDate, true)}
                          </TableCell>
                          <TableCell>
                            {formatDate(shift.closeDate, true)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!shifts.length && (
                    <div className="p-5">
                      <EmptyState
                        icon={Clock3}
                        title="Смен нет"
                        text="Для выбранного периода журнал пуст."
                      />
                    </div>
                  )}
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}
function AnalyticsTable({
  title,
  icon: Icon,
  headers,
  rows,
}: {
  title: string;
  icon: typeof Sparkles;
  headers: string[];
  rows: string[][];
}) {
  return (
    <Card className="surface overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row[0]}-${index}`}>
                {row.map((cell, cellIndex) => (
                  <TableCell
                    key={`${cell}-${cellIndex}`}
                    className={cellIndex === 0 ? "font-semibold" : ""}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length && (
          <div className="p-5">
            <EmptyState
              icon={Icon}
              title="Нет данных"
              text="Попробуйте изменить период."
            />
          </div>
        )}
      </div>
    </Card>
  );
}

function ProfileView({
  user,
  onPasswordChanged,
}: {
  user: User;
  onPasswordChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(
        "/api/auth/password",
        jsonBody({
          current_password: form.get("current_password"),
          new_password: form.get("new_password"),
        }),
      );
      (event.target as HTMLFormElement).reset();
      onPasswordChanged("Пароль изменён. Все остальные сессии закрыты.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageIntro
        eyebrow="Личный доступ"
        title="Профиль"
        description="Проверьте свои данные и обновите пароль доступа к системе."
      />
      <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <Card className="surface">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Avatar size="lg" className="bg-[#f0d9da] text-primary">
                <AvatarFallback className="bg-[#f0d9da] text-primary">
                  {initials(user.full_name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="text-xl font-bold">{user.full_name}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  @{user.username} · {roleName(user.role)}
                </div>
              </div>
            </div>
            <div className="mt-7 grid gap-3 text-sm">
              <InfoTile label="Точка">
                <span className="font-semibold">
                  {user.department_name || "Вся сеть"}
                </span>
              </InfoTile>
              <InfoTile label="Синхронизация iiko">
                <span className="font-semibold">
                  {user.iiko_employee_code || "Не привязано"}
                </span>
              </InfoTile>
            </div>
          </CardContent>
        </Card>
        <Card className="surface">
          <CardHeader>
            <CardTitle>Сменить пароль</CardTitle>
            <CardDescription>
              Используйте не менее 12 символов, чтобы сохранить доступ
              защищённым.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <X className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <form className="grid max-w-xl gap-4" onSubmit={submit}>
              <Field label="Текущий пароль">
                <Input
                  name="current_password"
                  type="password"
                  required
                  className="bg-white"
                />
              </Field>
              <Field label="Новый пароль">
                <Input
                  name="new_password"
                  type="password"
                  minLength={12}
                  required
                  className="bg-white"
                />
              </Field>
              <Button className="mt-2 w-fit gap-2" disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}{" "}
                Обновить пароль
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default App;
