import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "body" | "heading" | "circle" | "badge" | "shimmer";
}

export function Skeleton({ className, variant = "body", ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        variant === "shimmer" ? "skeleton-shimmer" : "skeleton-shimmer animate-pulse",
        variant === "heading" && "h-10 w-2/3 rounded-lg",
        variant === "body" && "h-4 w-full rounded",
        variant === "circle" && "h-12 w-12 rounded-full",
        variant === "badge" && "h-6 w-24 rounded-full",
        variant === "shimmer" && "h-full w-full",
        className
      )}
      {...props}
    />
  );
}

export function SkeletonCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "surface-card p-6 border-transparent bg-bg-surface/20 rounded-3xl",
        className
      )}
      {...props}
    >
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}

export function SkeletonStat({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-title tracking-[-0.02em] text-text-primary font-bold",
        className
      )}
      {...props}
    >
      ──
    </div>
  );
}

export function SkeletonChipRow({ count = 3, className, ...props }: { count?: number } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-4", className)} {...props}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-20 w-full skeleton-shimmer rounded-2xl"
          style={{ animationDelay: `${i * 100}ms` }}
        />
      ))}
    </div>
  );
}

export function SkeletonListRow({ count = 4, className, ...props }: { count?: number } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-4", className)} {...props}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-20 w-full skeleton-shimmer rounded-xl"
          style={{ animationDelay: `${i * 100}ms` }}
        />
      ))}
    </div>
  );
}
