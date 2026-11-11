/** 两条走势相反的弧线，在 TE 书心附近交汇后错落延展。 */
const RISING_ARC =
  "M-80 875 C120 790 310 722 540 682 C740 647 890 582 1030 637 C1310 737 1450 727 1740 477";
const FALLING_ARC =
  "M-80 480 C160 540 335 641 540 682 C720 722 840 772 1040 777 C1250 782 1520 782 1740 807";

/** 交汇两侧的极淡色块为曲线建立纵深，交汇点本身留给 TE 主视觉。 */
const LEFT_WASH =
  "M-80 480 C160 540 335 641 540 682 C310 722 120 790 -80 875 Z";
const RIGHT_WASH =
  "M540 682 C740 647 890 582 1030 637 C1310 737 1450 727 1740 477 L1740 807 C1520 782 1250 782 1040 777 C840 772 720 722 540 682 Z";

export function PrototypeHomeLightStreams() {
  return (
    <div className="prototype-home-ribbon" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient
            id="prototype-home-arc-wash"
            x1="0"
            y1="0"
            x2="0"
            y2="900"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#286b9e" stopOpacity="0.015" />
            <stop offset="1" stopColor="#05172c" stopOpacity="0.18" />
          </linearGradient>
          <linearGradient
            id="prototype-home-arc-line"
            x1="0"
            y1="0"
            x2="1600"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#398bcc" stopOpacity="0.28" />
            <stop offset="0.335" stopColor="#479bd6" stopOpacity="0.48" />
            <stop offset="0.65" stopColor="#2972b4" stopOpacity="0.26" />
            <stop offset="1" stopColor="#378fcb" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient
            id="prototype-home-arc-highlight"
            x1="0"
            y1="0"
            x2="1600"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#70caff" stopOpacity="0" />
            <stop offset="0.17" stopColor="#70caff" stopOpacity="0.025" />
            <stop offset="0.255" stopColor="#70caff" stopOpacity="0.11" />
            <stop offset="0.31" stopColor="#7fd0ff" stopOpacity="0.36" />
            <stop offset="0.336" stopColor="#b4ebff" stopOpacity="0.8" />
            <stop offset="0.352" stopColor="#70caff" stopOpacity="0.02" />
            <stop offset="1" stopColor="#70caff" stopOpacity="0" />
          </linearGradient>
          <filter
            id="prototype-home-arc-soft-glow"
            x="-12%"
            y="-60%"
            width="124%"
            height="220%"
          >
            <feGaussianBlur stdDeviation="8 2.8" />
          </filter>
        </defs>

        <path
          className="prototype-home-arc__wash"
          d={`${LEFT_WASH} ${RIGHT_WASH}`}
          fill="url(#prototype-home-arc-wash)"
        />
        {[RISING_ARC, FALLING_ARC].map((arc, index) => (
          <path
            key={index}
            className="prototype-home-arc__line"
            d={arc}
            fill="none"
            stroke="url(#prototype-home-arc-line)"
            strokeWidth={index === 0 ? 1.5 : 1.05}
            opacity={index === 0 ? 0.75 : 0.57}
          />
        ))}
        <path
          className="prototype-home-arc__glow"
          d={RISING_ARC}
          fill="none"
          stroke="url(#prototype-home-arc-highlight)"
          strokeWidth="8"
          opacity="0.46"
          filter="url(#prototype-home-arc-soft-glow)"
        />
        <path
          className="prototype-home-arc__glow"
          d={RISING_ARC}
          fill="none"
          stroke="url(#prototype-home-arc-highlight)"
          strokeWidth="1.5"
          opacity="0.68"
        />
      </svg>
    </div>
  );
}
