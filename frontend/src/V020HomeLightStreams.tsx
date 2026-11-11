/** 由独立的细光丝组成流光束，不使用宽描边或封闭的飘带形状。 */
type LightStream = {
  centerY: readonly number[];
  count: number;
  spacing: number;
  strength: number;
};

const STREAMS: readonly LightStream[] = [
  {
    centerY: [388, 353, 317, 348, 405, 392, 357, 329, 316, 352],
    count: 23,
    spacing: 1.9,
    strength: 1,
  },
  {
    centerY: [474, 435, 500, 464, 442, 422, 433, 455, 483, 461],
    count: 18,
    spacing: 1.65,
    strength: 0.82,
  },
  {
    centerY: [552, 523, 570, 537, 516, 496, 518, 535, 548, 560],
    count: 14,
    spacing: 1.35,
    strength: 0.73,
  },
  {
    centerY: [612, 586, 644, 602, 572, 548, 579, 574, 599, 615],
    count: 10,
    spacing: 1.25,
    strength: 0.62,
  },
];

function lightThreadPath(
  bundle: LightStream,
  threadIndex: number,
): string {
  const offset = (threadIndex - (bundle.count - 1) / 2) * bundle.spacing;
  const taper = [0.78, 1.03, 0.74, 1, 0.55, 0.9, 0.72, 1.12, 1.05, 0.73];
  const y = (point: number) => {
    // 各光丝轻微交织，边缘自然松开；同束仍保留相同的流向。
    const weave = Math.sin(threadIndex * 1.47 + point * 1.18) * 2.9;
    return (bundle.centerY[point] + offset * taper[point] + weave).toFixed(1);
  };

  return `M-130 ${y(0)} C205 ${y(1)} 340 ${y(2)} 606 ${y(3)} C790 ${y(4)} 986 ${y(5)} 1208 ${y(6)} C1395 ${y(7)} 1525 ${y(8)} 1730 ${y(9)}`;
}

const LIGHT_THREADS = STREAMS.map((bundle) =>
  Array.from({ length: bundle.count }, (_, index) => {
    const distanceFromCenter = Math.abs(index - (bundle.count - 1) / 2) /
      ((bundle.count - 1) / 2);
    const faintEdge = 1 - distanceFromCenter * 0.63;
    const highlight = index % 5 === 0;

    return {
      d: lightThreadPath(bundle, index),
      opacity: (faintEdge * bundle.strength * (highlight ? 0.74 : 0.48)).toFixed(2),
      strokeWidth: highlight ? 0.96 : index % 3 === 0 ? 0.68 : 0.42,
      gradient: highlight ? "ice" : index % 3 === 0 ? "azure" : "blue",
    };
  }),
);

export function PrototypeHomeLightStreams() {
  return (
    <div className="prototype-home-ribbon" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="prototype-home-thread-ice" x1="-130" y1="0" x2="1730" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#3abaff" stopOpacity="0" />
            <stop offset="0.21" stopColor="#57c8ff" stopOpacity="0.58" />
            <stop offset="0.52" stopColor="#b4f5ff" stopOpacity="0.98" />
            <stop offset="0.77" stopColor="#71d5ff" stopOpacity="0.58" />
            <stop offset="1" stopColor="#3abaff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="prototype-home-thread-azure" x1="-130" y1="0" x2="1730" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#247ec9" stopOpacity="0" />
            <stop offset="0.25" stopColor="#3597e2" stopOpacity="0.62" />
            <stop offset="0.58" stopColor="#6cceff" stopOpacity="0.9" />
            <stop offset="0.85" stopColor="#2b87dc" stopOpacity="0.48" />
            <stop offset="1" stopColor="#247ec9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="prototype-home-thread-blue" x1="-130" y1="0" x2="1730" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1c65b8" stopOpacity="0" />
            <stop offset="0.22" stopColor="#3174c9" stopOpacity="0.55" />
            <stop offset="0.62" stopColor="#408be1" stopOpacity="0.86" />
            <stop offset="0.86" stopColor="#235db6" stopOpacity="0.42" />
            <stop offset="1" stopColor="#1c65b8" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g className="prototype-home-ribbon__flow" fill="none">
          {LIGHT_THREADS.map((threads, streamIndex) => (
            <g className="prototype-home-ribbon__strand" key={streamIndex}>
              {threads.map((thread, index) => (
                <path
                  key={index}
                  d={thread.d}
                  stroke={`url(#prototype-home-thread-${thread.gradient})`}
                  strokeWidth={thread.strokeWidth}
                  opacity={thread.opacity}
                />
              ))}
            </g>
          ))}
        </g>

        {LIGHT_THREADS.slice(0, 3).map((threads, streamIndex) => (
          <g
            className={`prototype-home-ribbon__glint prototype-home-ribbon__glint--${streamIndex + 1}`}
            key={streamIndex}
            fill="none"
            stroke="#b7f5ff"
            strokeWidth="0.9"
            strokeDasharray="94 906"
          >
            {[0, 2, -2].map((shift, index) => (
              <path
                key={index}
                d={threads[Math.floor(threads.length / 2) + shift].d}
                pathLength={1000}
                opacity={index === 0 ? 0.85 : 0.38}
              />
            ))}
          </g>
        ))}

        <g className="prototype-home-ribbon__specks" fill="#a7e9ff">
          <circle cx="260" cy="346" r="1.4" />
          <circle cx="296" cy="359" r="0.75" opacity="0.5" />
          <circle cx="475" cy="442" r="1.1" opacity="0.75" />
          <circle cx="813" cy="414" r="0.9" />
          <circle cx="1039" cy="443" r="1.8" opacity="0.85" />
          <circle cx="1328" cy="330" r="1.2" />
          <circle cx="350" cy="556" r="0.8" />
          <circle cx="734" cy="549" r="1.5" />
          <circle cx="1254" cy="535" r="0.8" opacity="0.6" />
          <circle cx="1480" cy="585" r="1.2" />
          <circle cx="1039" cy="443" r="4.3" fill="#67c8ff" opacity="0.14" />
          <circle cx="734" cy="549" r="3.8" fill="#67d9ff" opacity="0.13" />
        </g>
      </svg>
    </div>
  );
}
