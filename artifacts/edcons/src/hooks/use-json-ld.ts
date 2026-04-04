import { useEffect } from "react";

export function useJsonLd(schema: object | object[]) {
  useEffect(() => {
    const schemas = Array.isArray(schema) ? schema : [schema];
    const elements: HTMLScriptElement[] = [];

    for (const s of schemas) {
      const el = document.createElement("script");
      el.type = "application/ld+json";
      el.textContent = JSON.stringify(s);
      document.head.appendChild(el);
      elements.push(el);
    }

    return () => {
      for (const el of elements) {
        if (document.head.contains(el)) document.head.removeChild(el);
      }
    };
  }, [JSON.stringify(schema)]);
}

export const SITE_URL = "https://findandstudy.com";
export const SITE_NAME = "Find And Study";

export const ORG_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_URL}/favicon.svg`,
    width: 512,
    height: 512,
  },
  contactPoint: {
    "@type": "ContactPoint",
    telephone: "+90-552-689-8515",
    contactType: "customer service",
    email: "info@findandstudy.com",
    availableLanguage: ["English", "Turkish", "Arabic", "French", "Russian"],
  },
  address: {
    "@type": "PostalAddress",
    streetAddress: "Levent Mahallesi, Büyükdere Cad. No:45",
    addressLocality: "Istanbul",
    postalCode: "34394",
    addressCountry: "TR",
  },
  sameAs: [
    "https://www.linkedin.com/company/findandstudy",
    "https://www.instagram.com/findandstudy",
  ],
};
