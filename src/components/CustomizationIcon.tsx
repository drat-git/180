import {
  Activity,
  BookOpen,
  BriefcaseBusiness,
  Check,
  Circle,
  Compass,
  Dumbbell,
  GraduationCap,
  Heart,
  House,
  Leaf,
  Star,
  Sun,
  Utensils,
  type LucideIcon,
} from "lucide-react";
const icons: Record<string, LucideIcon> = {
  activity: Activity,
  book: BookOpen,
  briefcase: BriefcaseBusiness,
  "briefcase-business": BriefcaseBusiness,
  compass: Compass,
  "graduation-cap": GraduationCap,
  heart: Heart,
  home: House,
  star: Star,
  sun: Sun,
  utensils: Utensils,
  leaf: Leaf,
  dumbbell: Dumbbell,
  circle: Circle,
  check: Check,
};
export function CustomizationIcon({ name }: { name: string }) {
  const Icon = icons[name] ?? Circle;
  return <Icon size={18} aria-hidden="true" />;
}
