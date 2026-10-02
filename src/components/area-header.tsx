import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logout } from "@/app/login/actions";

type AreaHeaderProps = {
  title: string;
  href: string;
  email: string;
  businessName?: string;
  links?: { href: string; label: string }[];
};

export function AreaHeader({ title, href, email, businessName, links }: AreaHeaderProps) {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-6">
          <Link href={href} className="font-semibold">
            {title}
          </Link>
          {links && (
            <nav className="flex items-center gap-4 text-sm">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="underline-offset-4 hover:underline"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          {businessName && <span>{businessName}</span>}
          <span className="text-muted-foreground">{email}</span>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
