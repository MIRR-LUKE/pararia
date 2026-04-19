import { ImageResponse } from "next/og";

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
          alignItems: "center",
          justifyContent: "center",
          background: "#171717",
        }}
      >
        <div
          style={{
            width: 144,
            height: 144,
            borderRadius: 36,
            background: "#dbff4b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              width: 40,
              height: 68,
              borderRadius: 20,
              border: "9px solid #171717",
              background: "transparent",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 62,
              height: 62,
              borderRadius: 31,
              border: "8px solid #171717",
              borderTopColor: "transparent",
              bottom: 38,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 10,
              height: 30,
              background: "#171717",
              bottom: 36,
              borderRadius: 999,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 46,
              height: 10,
              background: "#171717",
              bottom: 28,
              borderRadius: 999,
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
