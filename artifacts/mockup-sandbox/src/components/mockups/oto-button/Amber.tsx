export function Amber() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          background: "#0e0e0e",
          border: "1px solid #1e1e1e",
          borderRadius: "16px",
          padding: "52px 32px 36px",
          maxWidth: "520px",
          width: "100%",
          textAlign: "center",
          overflow: "visible",
        }}
      >
        <p
          style={{
            position: "absolute",
            top: "-18px",
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            display: "inline-block",
            fontSize: "10px",
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#fff",
            background: "#d91e1e",
            padding: "5px 12px",
            borderRadius: "5px",
          }}
        >
          One more thing
        </p>

        <p
          style={{
            fontSize: "20px",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "#fff",
            marginBottom: "10px",
            lineHeight: 1.3,
          }}
        >
          You're probably leaving money on the table.
        </p>
        <p
          style={{
            fontSize: "14px",
            fontWeight: 400,
            color: "#999",
            marginBottom: "24px",
            lineHeight: 1.5,
          }}
        >
          Let's find out if you could work two jobs at once.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            style={{
              background: "#f59e0b",
              border: "1px solid #f59e0b",
              color: "#1a0f00",
              fontSize: "15px",
              fontWeight: 700,
              padding: "14px 20px",
              borderRadius: "10px",
              cursor: "pointer",
              fontFamily: "inherit",
              width: "100%",
            }}
          >
            Show me →
          </button>
          <button
            style={{
              background: "none",
              border: "none",
              color: "#666",
              fontSize: "13px",
              fontWeight: 500,
              padding: "8px",
              cursor: "pointer",
              fontFamily: "inherit",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            No, I'm fine with one income
          </button>
        </div>
      </div>
    </div>
  );
}
