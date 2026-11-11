/** 首页仅保留两条低对比度背景弧线，局部蓝色高光静态点缀。 */
const UPPER_ARC = "M-140 775 C160 453 726 430 1740 300";
const LOWER_ARC = "M-140 853 C174 561 760 530 1740 380";

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
            <stop offset="0" stopColor="#1e66a7" stopOpacity="0.03" />
            <stop offset="1" stopColor="#05172c" stopOpacity="0.26" />
          </linearGradient>
          <linearGradient
            id="prototype-home-arc-line"
            x1="0"
            y1="0"
            x2="1600"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#398bcc" stopOpacity="0.3" />
            <stop offset="0.42" stopColor="#2972b4" stopOpacity="0.28" />
            <stop offset="1" stopColor="#378fcb" stopOpacity="0.37" />
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
            <stop offset="0.055" stopColor="#70caff" stopOpacity="0" />
            <stop offset="0.13" stopColor="#70caff" stopOpacity="0.1" />
            <stop offset="0.2" stopColor="#7fd0ff" stopOpacity="0.42" />
            <stop offset="0.225" stopColor="#b4ebff" stopOpacity="0.96" />
            <stop offset="0.235" stopColor="#70caff" stopOpacity="0" />
            <stop offset="0.485" stopColor="#70caff" stopOpacity="0" />
            <stop offset="0.55" stopColor="#70caff" stopOpacity="0.08" />
            <stop offset="0.62" stopColor="#7fd0ff" stopOpacity="0.36" />
            <stop offset="0.655" stopColor="#b4ebff" stopOpacity="0.88" />
            <stop offset="0.666" stopColor="#70caff" stopOpacity="0" />
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
          d={`${UPPER_ARC} L1740 380 C760 530 174 561 -140 853 Z`}
          fill="url(#prototype-home-arc-wash)"
        />
        {[UPPER_ARC, LOWER_ARC].map((arc, index) => (
          <path
            key={index}
            className="prototype-home-arc__line"
            d={arc}
            fill="none"
            stroke="url(#prototype-home-arc-line)"
            strokeWidth={index === 0 ? 1.65 : 1.1}
            opacity={index === 0 ? 0.9 : 0.54}
          />
        ))}
        <path
          className="prototype-home-arc__glow"
          d={UPPER_ARC}
          fill="none"
          stroke="url(#prototype-home-arc-highlight)"
          strokeWidth="8"
          opacity="0.65"
          filter="url(#prototype-home-arc-soft-glow)"
        />
        <path
          className="prototype-home-arc__glow"
          d={UPPER_ARC}
          fill="none"
          stroke="url(#prototype-home-arc-highlight)"
          strokeWidth="1.5"
          opacity="0.75"
        />
      </svg>
    </div>
  );
}
