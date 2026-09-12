import { Users, Home, Scissors, UserCog, MoreHorizontal } from "lucide-react";
export const navItems = [
  { label: "Сегодня", icon: Home, href: "/dashboard" },
  { label: "Клиенты", icon: Users, href: "/clients" },
  { label: "Услуги", icon: Scissors, href: "/services" },
  { label: "Мастера", icon: UserCog, href: "/masters" },
  { label: "Ещё", icon: MoreHorizontal, href: "/settings" },
];
