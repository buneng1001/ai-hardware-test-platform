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
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
