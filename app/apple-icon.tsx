import { ImageResponse } from "next/og";

// iOS home-screen bookmark icon: COS wordmark with a small "REPL" caption,
// on the app's accent black. Generated statically at build time.
export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#212121",
        }}
      >
        {/* COS wordmark (same path as CosLogo in app/page.tsx). */}
        <svg viewBox="0 0 80 28" width={116} height={41}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            d="M14.456 0c4.2776 0 8.039 1.76096 10.5995 4.67902v.00675l-2.9586 2.79999c-1.8824-2.12192-4.5204-3.48144-7.6409-3.48144-5.39757 0-9.91803 4.60143-9.91803 9.99898 0 5.3976 4.51709 9.999 9.91803 9.999 3.1205 0 5.8395-1.3224 7.6409-3.4409l3.08 2.638c-2.5604 2.962-6.3624 4.8005-10.7209 4.8005C6.697 27.9999.456055 21.7994.456055 14 .456055 6.20046 6.697 0 14.456 0Zm27.6792 0c7.759 0 13.9965 6.27805 13.9965 14 0 7.7218-6.2409 13.9999-13.9999 13.9999s-14-6.2814-14-13.9999c0-7.71858 6.2848-14 14.0034-14Zm.0404 23.999c5.4381 0 9.881-4.6386 9.881-9.999 0-5.36051-4.4395-9.99905-9.881-9.99905-5.4414 0-9.9585 4.60143-9.9585 9.99905 0 5.3975 4.5205 9.999 9.9585 9.999Zm20.4502-3.0834-2.6785 3.1205c2.4795 2.719 5.998 3.9604 9.6785 3.9604 5.1985 0 9.918-3.2419 9.918-8.1604 0-5.1595-4.705-6.6825-8.8374-8.0202-3.2358-1.0475-6.1206-1.9813-6.1206-4.45834 0-2.28047 2.24-3.35998 5.0805-3.35998 2.3614 0 4.679 1.07951 6.2814 2.32095l2.1185-3.27902C75.6677 1.07951 72.6653 0 69.5887 0c-4.48 0-9.0814 2.63806-9.0814 7.43853 0 5.18347 4.7487 6.70947 8.8949 8.04177 3.2124 1.0323 6.0631 1.9483 6.0631 4.3591 0 2.8776-2.9181 4.1595-5.8395 4.1595-2.6381 0-5.4381-1.518-7-3.0799v-.0034Z"
          />
        </svg>
        <div
          style={{
            marginTop: 18,
            color: "#ffffff",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: 10,
            // Compensate letter-spacing after the last glyph to keep "REPL"
            // optically centered under the wordmark.
            paddingLeft: 10,
          }}
        >
          REPL
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
