// Job sites that turn away automatic requests, so asking them is a waste of
// the user's time. Used by the form and by the server. To add a site, add an
// entry with the name people know it by.

export type BlockedSite = { name: string; hosts: string[] };

export const BLOCKED_SITES: BlockedSite[] = [
  {
    name: "JobStreet",
    hosts: [
      "jobstreet.com",
      "jobstreet.com.ph",
      "jobstreet.com.my",
      "jobstreet.com.sg",
      "jobstreet.co.id",
      "jobsdb.com",
    ],
  },
];

// The site a link belongs to, when it is one of the listed hosts or a
// subdomain of one. Null for every other link and for text that is no link.
export function blockedSite(url: string): BlockedSite | null {
  let hostname: string;
  try {
    hostname = new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  return (
    BLOCKED_SITES.find((site) =>
      site.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)),
    ) ?? null
  );
}

export function blockedSiteMessage(site: BlockedSite) {
  return `${site.name} doesn't allow automatic import. Open the job post, copy the description, and paste it here.`;
}
