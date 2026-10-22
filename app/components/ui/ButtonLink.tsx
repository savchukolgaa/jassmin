import type { ComponentProps } from "react";
import { Link } from "react-router";
import { type ButtonSize, type ButtonVariant, buttonClasses } from "./button-styles";

export type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

/** A React Router `<Link>` styled as a button, for CTAs that navigate. */
export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link {...props} className={buttonClasses({ variant, size, className })} />;
}
