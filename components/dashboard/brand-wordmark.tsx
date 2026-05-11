import { cn } from "@/lib/utils";

/**
 * Brand wordmark rendered with CSS (not the logo PNG) so it sits flat on the
 * sidebar background without a cream rectangle around it. Uses the Fraunces
 * variable serif loaded in app/layout.tsx for the "ZENNA" mark and a small
 * tracked sans-serif tagline below.
 */
type Size = "sm" | "md" | "lg";

const SIZE: Record<
  Size,
  { mark: string; tag: string; gap: string; tracking: string }
> = {
  sm: {
    mark: "text-xl",
    tag: "text-[0.55rem]",
    gap: "mt-0.5",
    tracking: "tracking-[0.28em]",
  },
  md: {
    mark: "text-3xl",
    tag: "text-[0.625rem]",
    gap: "mt-1",
    tracking: "tracking-[0.32em]",
  },
  lg: {
    mark: "text-[2.5rem] leading-[0.95]",
    tag: "text-[0.7rem]",
    gap: "mt-1.5",
    tracking: "tracking-[0.34em]",
  },
};

export function BrandWordmark({
  size = "md",
  className,
}: {
  size?: Size;
  className?: string;
}) {
  const s = SIZE[size];
  return (
    <div className={cn("flex flex-col items-center select-none", className)}>
      <span
        className={cn(
          "font-display font-medium text-foreground tracking-tight",
          s.mark,
        )}
        style={{ fontFeatureSettings: '"ss01"' }}
      >
        ZENNA
      </span>
      <span
        className={cn(
          "uppercase font-medium text-gold-gradient",
          s.tag,
          s.gap,
          s.tracking,
        )}
      >
        Hair Salon
      </span>
    </div>
  );
}
