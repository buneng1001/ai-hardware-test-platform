/**
 * 首页品牌：封皮、左右书页与 T / E 字母独立绘制，方便自然地开书、弹出、回弹。
 * 沿用用户确认的蓝色发光书本轮廓，而非将参考图片贴在页面上。
 */
export function PrototypeTeBookMotion() {
  return (
    <div
      className="te-book-motion"
      data-testid="prototype-home-brand-motion"
      role="img"
      aria-label="书本展开，T 和 E 从书心弹出、轻微回弹并悬浮"
    >
      <svg
        viewBox="0 0 900 625"
        preserveAspectRatio="xMidYMid meet"
        data-logo-variant="TE-book-motion"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="te-motion-letter-t" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#1044f6" />
            <stop offset="0.58" stopColor="#008cf8" />
            <stop offset="1" stopColor="#38fbe4" />
          </linearGradient>
          <linearGradient id="te-motion-letter-e" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#064deb" />
            <stop offset="0.52" stopColor="#00b0fa" />
            <stop offset="1" stopColor="#39f9e3" />
          </linearGradient>
          <linearGradient id="te-motion-page-top" x1="0" y1="0" x2="0.5" y2="1">
            <stop offset="0" stopColor="#52fff1" />
            <stop offset="0.57" stopColor="#0be5f1" />
            <stop offset="1" stopColor="#0485fc" />
          </linearGradient>
          <linearGradient
            id="te-motion-page-middle"
            x1="0"
            y1="0"
            x2="1"
            y2="0.8"
          >
            <stop offset="0" stopColor="#10a2ff" />
            <stop offset="0.54" stopColor="#1ceefa" />
            <stop offset="1" stopColor="#00c3ff" />
          </linearGradient>
          <linearGradient id="te-motion-page-lower" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#003cf5" />
            <stop offset="0.65" stopColor="#0688fc" />
            <stop offset="1" stopColor="#2beafb" />
          </linearGradient>
          <radialGradient id="te-motion-spine-glow">
            <stop offset="0" stopColor="#e1ffff" stopOpacity="0.98" />
            <stop offset="0.3" stopColor="#19f7ff" stopOpacity="0.8" />
            <stop offset="1" stopColor="#1272ff" stopOpacity="0" />
          </radialGradient>
          <filter
            id="te-motion-soft-glow"
            x="-100%"
            y="-200%"
            width="300%"
            height="500%"
          >
            <feGaussianBlur stdDeviation="16" />
          </filter>
          <filter
            id="te-motion-spine-blur"
            x="-150%"
            y="-200%"
            width="400%"
            height="500%"
          >
            <feGaussianBlur stdDeviation="22" />
          </filter>
        </defs>

        <ellipse
          className="te-book-motion__ground-light"
          cx="450"
          cy="594"
          rx="260"
          ry="22"
          fill="#008eff"
          opacity="0.68"
          filter="url(#te-motion-soft-glow)"
        />

        {/* 开场时的合页精装书：有封皮、厚度，而不是纸片叠在一起。 */}
        <g className="te-book-motion__closed">
          <path
            d="M298 521 444 465 605 524 452 583Z"
            fill="#073bd5"
            stroke="#3ceafb"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path d="M298 521 452 583 452 603 298 540Z" fill="#06208e" />
          <path d="M452 583 605 524 605 543 452 603Z" fill="#0753c8" />
          <path
            d="M317 516 444 476 586 524 452 570Z"
            fill="#0a84fc"
            fillOpacity="0.75"
          />
        </g>

        <g className="te-book-motion__open-book">
          <path
            className="te-book-motion__cover"
            d="M452 560 C346 511 202 518 64 553 L64 568 C206 531 348 529 427 590 Q449 607 474 589 C554 528 693 532 837 567 L837 552 C688 514 545 509 452 560Z"
            fill="#073bc5"
            stroke="#077cff"
            strokeWidth="2"
          />

          <g className="te-book-motion__pages-left">
            <path
              d="M449 536 C404 474 293 424 185 428 Q169 429 153 441 C279 424 382 478 449 536Z"
              fill="url(#te-motion-page-top)"
              stroke="#7ffffb"
              strokeWidth="1.25"
            />
            <path
              d="M447 550 C370 471 260 450 123 468 Q108 473 99 489 C253 457 369 492 447 550Z"
              fill="url(#te-motion-page-middle)"
              stroke="#14e8ff"
              strokeWidth="1.5"
            />
            <path
              d="M447 561 C344 497 210 493 63 535 Q42 544 55 560 Q60 566 76 559 C222 519 353 517 429 579Z"
              fill="url(#te-motion-page-lower)"
              stroke="#30baff"
              strokeWidth="1.4"
            />
          </g>

          <g className="te-book-motion__pages-right">
            <path
              d="M451 536 C496 474 607 424 715 428 Q731 429 747 441 C621 424 518 478 451 536Z"
              fill="url(#te-motion-page-top)"
              stroke="#7ffffb"
              strokeWidth="1.25"
            />
            <path
              d="M453 550 C530 471 640 450 777 468 Q792 473 801 489 C647 457 531 492 453 550Z"
              fill="url(#te-motion-page-middle)"
              stroke="#14e8ff"
              strokeWidth="1.5"
            />
            <path
              d="M453 561 C556 497 690 493 837 535 Q858 544 845 560 Q840 566 824 559 C678 519 547 517 471 579Z"
              fill="url(#te-motion-page-lower)"
              stroke="#30baff"
              strokeWidth="1.4"
            />
          </g>

          <ellipse
            className="te-book-motion__spine-light"
            cx="450"
            cy="557"
            rx="84"
            ry="61"
            fill="url(#te-motion-spine-glow)"
            filter="url(#te-motion-spine-blur)"
          />
          <path
            className="te-book-motion__spine"
            d="M415 571 Q450 596 486 571 Q458 608 438 589Z"
            fill="#0353df"
            stroke="#0cbcff"
            strokeWidth="2"
          />
          <ellipse
            className="te-book-motion__spine-flash"
            cx="450"
            cy="549"
            rx="70"
            ry="63"
            fill="url(#te-motion-spine-glow)"
          />
        </g>

        {/* 光点从书脊的同一个发光中心向上浮出，不从画面两侧飞入。 */}
        <g className="te-book-motion__book-sparkles">
          <g className="te-book-motion__sparkle te-book-motion__sparkle--left">
            <path
              d="M450 542 Q453 554 464 557 Q453 560 450 573 Q447 560 436 557 Q447 554 450 542Z"
              fill="#b3fff9"
            />
            <circle
              cx="450"
              cy="557"
              r="11"
              fill="url(#te-motion-spine-glow)"
            />
          </g>
          <g className="te-book-motion__sparkle te-book-motion__sparkle--right">
            <path
              d="M450 545 Q452 553 461 556 Q452 558 450 567 Q448 558 439 556 Q448 553 450 545Z"
              fill="#96fff8"
            />
            <circle cx="450" cy="556" r="8" fill="url(#te-motion-spine-glow)" />
          </g>
        </g>

        {/* 统一轻微左上移；T 放大约 10%，E 缩小约 8%，保留错位与适度字距。 */}
        <g
          className="te-book-motion__letters-layout"
          transform="translate(-18 -16)"
        >
          <g className="te-book-motion__letter-t">
            <g transform="translate(-40 -22) scale(1.1)">
              <path
                d="M302 93 H523 L496 143 H435 V348 H359 V143 H273Z"
                fill="url(#te-motion-letter-t)"
              />
            </g>
          </g>
          <g className="te-book-motion__letter-e">
            <g transform="translate(47 23) scale(0.92)">
              <path
                d="M481 171 H696 L671 221 H544 V254 H666 L644 300 H544 V353 H701 L675 405 H481Z"
                fill="url(#te-motion-letter-e)"
              />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
