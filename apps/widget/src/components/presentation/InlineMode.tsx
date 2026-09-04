import React from "react";

export interface InlineModeProps {
  children: React.ReactNode;
}

export const InlineMode: React.FC<InlineModeProps> = ({ children }) => {
  return (
    <div
      className="zyon-presentation-inline"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        boxShadow: "none",
        background: "transparent"
      }}
    >
      {children}
    </div>
  );
};
