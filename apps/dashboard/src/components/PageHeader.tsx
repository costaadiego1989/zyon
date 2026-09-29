import React, { type ReactNode, type Ref } from "react";

export function PageHeader({ title, description, actions, titleRef }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  return <header className="page-head page-header">
    <div className="page-header__copy"><h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined}>{title}</h1>{description && <p className="page-lead">{description}</p>}</div>
    {actions && <div className="page-header__actions">{actions}</div>}
  </header>;
}
