import {
  Users,
  Home,
  Scissors,
  UserCog,
  MoreHorizontal,
  Calendar,
  AlertCircle,
  MessageSquare,
  ArrowRightLeft,
  Activity,
  Zap,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: any;
  href: string;
  roles?: string[];
}

export const navItems: NavItem[] = [
  { label: "Сегодня", icon: Home, href: "/dashboard" },
  { label: "Внимание", icon: AlertCircle, href: "/needs-attention" },
  { label: "Передачи", icon: ArrowRightLeft, href: "/handoffs" },
  { label: "Диалоги", icon: MessageSquare, href: "/conversations" },
  { label: "Календарь", icon: Calendar, href: "/calendar" },
  { label: "Клиенты", icon: Users, href: "/clients" },
  { label: "Услуги", icon: Scissors, href: "/services" },
  { label: "Мастера", icon: UserCog, href: "/masters" },
  { label: "Автоматизации", icon: Zap, href: "/automations", roles: ["OWNER", "ADMIN"] },
  { label: "Операции", icon: Activity, href: "/operations", roles: ["OWNER", "ADMIN"] },
  { label: "Ещё", icon: MoreHorizontal, href: "/settings" },
];

export const mobileNavItems: NavItem[] = [
  { label: "Сегодня", icon: Home, href: "/dashboard" },
  { label: "Внимание", icon: AlertCircle, href: "/needs-attention" },
  { label: "Календарь", icon: Calendar, href: "/calendar" },
  { label: "Диалоги", icon: MessageSquare, href: "/conversations" },
  { label: "Клиенты", icon: Users, href: "/clients" },
  { label: "Ещё", icon: MoreHorizontal, href: "/settings" },
];

export function getVisibleNavItems(role?: string | null): NavItem[] {
  return navItems.filter((item) => {
    if (!item.roles) return true;
    if (!role) return false;
    return item.roles.includes(role);
  });
}
