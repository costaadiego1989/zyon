import type { ImageTextSplitBlockData } from "./types";

export default function ImageTextSplitBlock({
  block,
}: {
  block: ImageTextSplitBlockData;
}) {
  const isImageLeft = block.imageSide === "left";
  const imageCol = (
    <div
      style={{
        width: "100%",
        minWidth: 0,
        borderRadius: "var(--aacp-radius-md)",
        overflow: "hidden",
        background: "var(--aacp-surface-2)",
      }}
    >
      <img
        src={block.imageSrc}
        alt={block.imageAlt}
        loading="lazy"
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          objectFit: "cover",
        }}
      />
    </div>
  );
  const textCol = (
    <div
      style={{
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        fontFamily: "var(--aacp-font)",
        color: "var(--aacp-fg)",
      }}
    >
      {block.heading && (
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--aacp-font-display)",
            fontSize: "18px",
            fontWeight: 700,
            lineHeight: 1.25,
          }}
        >
          {block.heading}
        </h3>
      )}
      <p
        style={{
          margin: 0,
          fontSize: "14.5px",
          lineHeight: 1.6,
          color: "var(--aacp-muted)",
        }}
      >
        {block.text}
      </p>
    </div>
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: "16px",
        alignItems: "center",
        margin: "16px 0",
      }}
      className="aacp-img-text-split"
    >
      <style>{`
        @media (max-width: 640px) {
          .aacp-img-text-split {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
      `}</style>
      {isImageLeft ? (
        <>
          {imageCol}
          {textCol}
        </>
      ) : (
        <>
          {textCol}
          {imageCol}
        </>
      )}
    </div>
  );
}
