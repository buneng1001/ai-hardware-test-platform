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
      <svg viewBox="0 0 90 90" role="presentation" focusable="false">
        <path
          className="prototype-brand-link-primary"
          d="M10 43 33 20a6 6 0 0 1 8 0l17 17a6 6 0 0 1 0 8L35 68a6 6 0 0 1-8 0L10 51a6 6 0 0 1 0-8Z"
        />
        <path
          className="prototype-brand-link-secondary"
          d="M30 51 53 28a6 6 0 0 1 8 0l17 17a6 6 0 0 1 0 8L55 76a6 6 0 0 1-8 0L30 59a6 6 0 0 1 0-8Z"
        />
      </svg>
    </span>
  );
}
