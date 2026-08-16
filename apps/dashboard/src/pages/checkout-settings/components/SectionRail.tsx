import React from "react";

export function SectionRail({
  icon,
  index,
  title,
  desc,
  aside,
  children,
}: {
  icon: React.ReactNode;
  index: string;
  title: string;
  desc: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="cfg-section">
      <div className="cfg-section-head">
        <div className="cfg-section-mark" aria-hidden="true">
          {icon}
        </div>
        <div className="cfg-section-heading">
          <div className="cfg-section-titlerow">
            <span className="cfg-section-index" aria-hidden="true">
              {index}
            </span>
            <h2>{title}</h2>
          </div>
          <p>{desc}</p>
        </div>
        {aside ? <div className="cfg-section-aside">{aside}</div> : null}
      </div>
      <div className="cfg-section-body">{children}</div>
    </section>
  );
}
