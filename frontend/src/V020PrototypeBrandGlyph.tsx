/** 顶栏和侧边栏使用首页 TE 翻书标志的静态紧凑版，保持品牌一致。 */
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
        data-logo-variant="TE-book-compact"
      >
        <defs>
          <linearGradient id="te-mini-letters" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#0752f6" />
            <stop offset="0.56" stopColor="#08a6ff" />
            <stop offset="1" stopColor="#37fff0" />
          </linearGradient>
          <linearGradient id="te-mini-pages" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#53fff2" />
            <stop offset="1" stopColor="#076af5" />
          </linearGradient>
        </defs>
        <path
          d="M21 17 H67 L61 27 H47 V70 H35 V27 H15Z"
          fill="url(#te-mini-letters)"
        />
        <path
          d="M66 37 H105 L99 46 H77 V53 H98 L93 62 H77 V70 H106 L100 80 H66Z"
          fill="url(#te-mini-letters)"
        />
        <path
          d="M60 96 C42 81 29 78 11 82 C29 81 48 87 60 96Z"
          fill="#4dfff0"
        />
        <path
          d="M60 96 C78 81 91 78 109 82 C91 81 72 87 60 96Z"
          fill="#4dfff0"
        />
        <path
          d="M60 102 C43 88 24 85 7 93 C27 90 47 94 60 102Z"
          fill="url(#te-mini-pages)"
        />
        <path
          d="M60 102 C77 88 96 85 113 93 C93 90 73 94 60 102Z"
          fill="url(#te-mini-pages)"
        />
        <path
          d="M60 105 C45 96 25 95 5 102 C32 100 46 105 60 111 C74 105 88 100 115 102 C95 95 75 96 60 105Z"
          fill="#126eff"
        />
        <path
          d="M52 104 Q60 114 68 104"
          fill="none"
          stroke="#53eaff"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
