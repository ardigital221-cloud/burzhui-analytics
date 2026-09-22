import type { ComponentProps } from "react";
import { ChevronDown, X } from "lucide-react";

/**
 * ReUI source compatibility adapter.
 * ReUI is MIT licensed and distributed as copy-owned registry code.
 * This project intentionally uses lucide-react for its icon implementation.
 */
const icons = {
  ChevronDownIcon: ChevronDown,
  XIcon: X,
} as const;

type IconName = keyof typeof icons;

type IconPlaceholderProps = ComponentProps<"svg"> & {
  lucide?: IconName;
  tabler?: string;
  hugeicons?: string;
  phosphor?: string;
  remixicon?: string;
};

export function IconPlaceholder({
  lucide = "ChevronDownIcon",
  ...props
}: IconPlaceholderProps) {
  const Icon = icons[lucide];
  return <Icon {...props} />;
}
