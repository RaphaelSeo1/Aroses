import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_NAME } from "@/lib/brand";

export const runtime = "nodejs";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image() {
  const iconBytes = await readFile(
    join(process.cwd(), "public/aroses-icon.png")
  );
  const iconSrc = `data:image/png;base64,${iconBytes.toString("base64")}`;

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
          background: "linear-gradient(145deg, #dc2626 0%, #b91c1c 55%, #991b1b 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <img
          src={iconSrc}
          width={220}
          height={220}
          alt=""
          style={{ borderRadius: 48 }}
        />
        <div
          style={{
            marginTop: 36,
            fontSize: 72,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-0.02em",
          }}
        >
          {APP_NAME}
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 32,
            fontWeight: 500,
            color: "rgba(255,255,255,0.92)",
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.35,
          }}
        >
          Built for the classes that break you
        </div>
      </div>
    ),
    { ...size }
  );
}
