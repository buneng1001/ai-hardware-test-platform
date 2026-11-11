/** 由独立的细光丝组成流光束，不使用宽描边或封闭的飘带形状。 */
type LightStream = {
  centerY: readonly number[];
  count: number;
  spacing: number;
  strength: number;
};

const STREAMS: readonly LightStream[] = [
  {
    // 一束沿首页下方舒展的主光流，局部收束后向右自然散开。
    centerY: [574, 648, 690, 640, 612, 564, 480, 515],
    count: 25,
    spacing: 1.7,
    strength: 0.7,
  },
  {
    // 第二束刻意更轻，形成景深而不与主光流抢视觉焦点。
    centerY: [695, 741, 755, 718, 686, 672, 638, 688],
    count: 17,
    spacing: 1.35,
    strength: 0.34,
  },
];

const STREAM_X = [-130, 145, 420, 695, 970, 1245, 1520, 1795];

function lightThreadPath(
  bundle: LightStream,
  threadIndex: number,
): string {
  const offset = (threadIndex - (bundle.count - 1) / 2) * bundle.spacing;
  const taper = [1.16, 0.95, 0.68, 1.16, 0.73, 0.12, 1.24, 1.35];
  const y = (point: number) => {
    // 各光丝轻微交织，边缘自然松开；同束仍保留相同的流向。
    const weave = Math.sin(threadIndex * 1.47 + point * 1.18) * 2.9;
    return bundle.centerY[point] + offset * taper[point] + weave;
  };

  const points = STREAM_X.map((x, point) => ({ x, y: y(point) }));
  const segments = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 2)];
    // Catmull-Rom 插值转三次贝塞尔：光丝连续弯曲，不出现折线式接缝。
    const c1x = start.x + (end.x - before.x) / 6;
    const c1y = start.y + (end.y - before.y) / 6;
    const c2x = end.x - (after.x - start.x) / 6;
    const c2y = end.y - (after.y - start.y) / 6;
    return `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${end.x} ${end.y.toFixed(1)}`;
  });

  return `M${points[0].x} ${points[0].y.toFixed(1)} ${segments.join(" ")}`;
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

        {LIGHT_THREADS.slice(0, 1).map((threads, streamIndex) => (
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
          <circle cx="324" cy="652" r="0.85" opacity="0.65" />
          <circle cx="560" cy="657" r="1.1" opacity="0.78" />
          <circle cx="835" cy="601" r="0.8" />
          <circle cx="1046" cy="561" r="1.45" opacity="0.8" />
          <circle cx="1241" cy="561" r="0.7" opacity="0.55" />
          <circle cx="1410" cy="493" r="1" opacity="0.72" />
          <circle cx="1046" cy="561" r="3.8" fill="#67c8ff" opacity="0.11" />
        </g>
      </svg>
    </div>
  );
}
