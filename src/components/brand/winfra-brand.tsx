import Image from "next/image";

import styles from "./winfra-brand.module.css";

type WinfraBrandProps = {
  className?: string;
  compact?: boolean;
  priority?: boolean;
  size?: number;
  tone?: "default" | "inverse";
};

export function WinfraBrand({
  className,
  compact = false,
  priority = false,
  size = 32,
  tone = "default",
}: WinfraBrandProps) {
  const classes = [
    styles.brand,
    tone === "inverse" ? styles.inverse : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      aria-label="WinfraBR"
      style={
        {
          "--winfra-brand-size": `${size}px`,
          "--winfra-wordmark-size": `${Math.max(16, Math.round(size * 0.68))}px`,
        } as React.CSSProperties
      }
    >
      <Image
        alt=""
        aria-hidden="true"
        className={styles.mark}
        height={size}
        priority={priority}
        src="/brand/winfra-mark.png"
        width={size}
      />
      {compact ? null : (
        <span className={styles.wordmark}>
          Winfra<strong>BR</strong>
        </span>
      )}
    </span>
  );
}
