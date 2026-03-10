import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "body" | "heading" | "circle" | "badge";
}

export function Skeleton({ className, variant = "body", ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-color-border-strong rounded-md",
        variant === "heading" && "h-10 w-2/3",
        variant === "body" && "h-4 w-full",
        variant === "circle" && "h-12 w-12 rounded-full",
        variant === "badge" && "h-6 w-24 rounded-full",
        className
      )}
      {...props}
    />
  );
}
