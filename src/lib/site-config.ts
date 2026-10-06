export const siteConfig = {
  contactEmail: "ruellm@yahoo.com",
  productName: "Resume Screener",
  company: "OneOverZero",
} as const;

export const demoMailto = `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(
  `${siteConfig.productName} demo request`,
)}`;
