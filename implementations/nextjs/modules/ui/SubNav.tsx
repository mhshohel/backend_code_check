import Link from 'next/link';

export function SubNav({ label, links }: { readonly label: string; readonly links: ReadonlyArray<{ href: string; text: string }> }) {
  return (
    <nav aria-label={label} className="subnav">
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.text}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
