/** 首页仅保留两条低对比度背景弧线，局部蓝色高光静态点缀。 */
const UPPER_ARC = "M-140 955 C160 633 726 610 1740 480";
const LOWER_ARC = "M-140 1033 C174 741 760 710 1740 560";

export function PrototypeHomeLightStreams() {
  return (
    <div className="prototype-home-ribbon" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="prototype-home-arc-wash" x1="0" y1="0" x2="0" y2="900" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1e66a7" stopOpacity="0.03" />
            <stop offset="1" stopColor="#05172c" stopOpacity="0.26" />
          </linearGradient>
          <linearGradient id="prototype-home-arc-line" x1="0" y1="0" x2="1600" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#398bcc" stopOpacity="0.3" />
            <stop offset="0.42" stopColor="#2972b4" stopOpacity="0.28" />
            <stop offset="1" stopColor="#378fcb" stopOpacity="0.37" />
          </linearGradient>
          <linearGradient id="prototype-home-arc-highlight" x1="0" y1="0" x2="1600" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#70caff" stopOpacity="0" />
            <stop offset="0.095" stopColor="#70caff" stopOpacity="0" />
            <stop offset="0.145" stopColor="#89d6ff" stopOpacity="0.95" />
            <stop offset="0.195" stopColor="#70caff" stopOpacity="0" />
            <stop offset="0.55" stopColor="#70caff" stopOpacity="0" />
            <stop offset="0.61" stopColor="#89d6ff" stopOpacity="0.85" />
            <stop offset="0.67" stopColor="#70caff" stopOpacity="0" />
            <stop offset="1" stopColor="#70caff" stopOpacity="0" />
          </linearGradient>
          <filter id="prototype-home-arc-soft-glow" x="-12%" y="-60%" width="124%" height="220%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        <path
          className="prototype-home-arc__wash"
          d={`${UPPER_ARC} L1740 560 C760 710 174 741 -140 1033 Z`}
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
