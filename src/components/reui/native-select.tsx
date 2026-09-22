// Source: official ReUI Base UI/Nova registry. License: MIT.
import * as React from "react";
import { cn } from "@/lib/utils";

import { IconPlaceholder } from "@/components/reui/icon-placeholder";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

function NativeSelect({
  className,
  size = "default",
  children,
  ...props
}: NativeSelectProps) {
  // Compatibility bridge for the registry's normal direct-children API and
  // the native <select> composition used by this app's form screens.
  const nestedSelect =
    React.isValidElement(children) && children.type === "select"
      ? (children as React.ReactElement<React.ComponentProps<"select">>)
      : null;
  const selectProps = nestedSelect?.props ?? {};
  const selectChildren = nestedSelect?.props.children ?? children;
  return (
    <div
      className={cn(
        "cn-native-select-wrapper group/native-select relative w-fit has-[select:disabled]:opacity-50",
        className,
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "cn-native-select outline-none disabled:pointer-events-none disabled:cursor-not-allowed",
          selectProps.className,
        )}
        {...props}
        {...selectProps}
      >
        {selectChildren}
      </select>
      <IconPlaceholder
        lucide="ChevronDownIcon"
        tabler="IconSelector"
        hugeicons="UnfoldMoreIcon"
        phosphor="CaretDownIcon"
        remixicon="RiArrowDownSLine"
        className="cn-native-select-icon pointer-events-none absolute select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  );
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  );
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
