import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
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
          color: "#171717",
        }}
      >
        <div
          style={{
            width: 384,
            height: 384,
            borderRadius: 96,
            background: "#dbff4b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              width: 108,
              height: 180,
              borderRadius: 54,
              border: "24px solid #171717",
              borderBottomWidth: 28,
              background: "transparent",
              position: "relative",
              display: "flex",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 172,
              height: 172,
              borderRadius: 86,
              border: "22px solid #171717",
              borderTopColor: "transparent",
              borderLeftColor: "#171717",
              borderRightColor: "#171717",
              borderBottomColor: "#171717",
              bottom: 86,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 24,
              height: 92,
              background: "#171717",
              bottom: 84,
              borderRadius: 999,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 120,
              height: 24,
              background: "#171717",
              bottom: 66,
              borderRadius: 999,
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
