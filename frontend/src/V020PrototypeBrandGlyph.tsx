export function PrototypeBrandGlyph({
  className,
  testId,
}: {
  className: string;
  testId?: string;
}) {
  return (
    <span
      className={`prototype-brand-glyph ${className}`}
      data-testid={testId}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 120 120"
        role="presentation"
        focusable="false"
        data-logo-variant="C"
      >
        {/* C 方案：一体化六边形框架、核心立方体与穿过框架的蓝色轨迹。 */}
        <path
          className="prototype-brand-c-orbit-back"
          d="M11 87 C25 67 89 40 112 48 C122 52 108 67 92 75"
        />
        <path
          className="prototype-brand-c-frame"
          d="M84 29 61 16 29 35v45l32 19 28-17V65"
        />
        <path
          className="prototype-brand-c-frame-edge"
          d="M29 80 61 99 89 82V65"
        />
        <path
          className="prototype-brand-c-cube-top"
          d="M47 52 61 44 77 52 62 61Z"
        />
        <path
          className="prototype-brand-c-cube-left"
          d="M47 52 62 61v19L47 71Z"
        />
        <path
          className="prototype-brand-c-cube-right"
          d="M62 61 77 52v19L62 80Z"
        />
        <path
          className="prototype-brand-c-orbit-front"
          d="M15 84 C20 98 50 101 79 88 C107 76 120 58 113 49"
        />
      </svg>
    </span>
  );
}
