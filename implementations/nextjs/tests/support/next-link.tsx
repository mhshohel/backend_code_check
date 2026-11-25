import type { AnchorHTMLAttributes, ReactNode } from 'react';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode; prefetch?: boolean };

/** Test double for next/link: a plain anchor. */
export default function Link({ href, children, prefetch: _prefetch, ...rest }: Props) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
