import { qrModules } from "@/lib/upi";

/**
 * The payment link as a scannable QR.
 *
 * Rendered on the server into inline SVG: no image to store, no file to go
 * stale, and the amount and this week's collector are both baked into the code
 * itself rather than announced beside it.
 *
 * Deliberately dark-on-white in both themes. Scanners expect that polarity and
 * many fail on an inverted code, so a QR that politely followed the page into
 * dark mode would be a QR that half the group cannot scan.
 */
export function UpiQr({ text, size = 200 }: { text: string; size?: number }) {
  const modules = qrModules(text);
  const count = modules.length;

  // Four modules of clear space on every side. The spec requires it and
  // scanners genuinely fail without it.
  const quiet = 4;
  const extent = count + quiet * 2;

  // One path for the whole code rather than several hundred <rect> elements.
  let d = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (modules[row][col]) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      role="img"
      aria-label="UPI payment QR code"
      // Without this the browser antialiases module edges and the code reads as
      // a grey blur at small sizes.
      shapeRendering="crispEdges"
      className="rounded-lg"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
